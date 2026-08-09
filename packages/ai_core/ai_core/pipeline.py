"""Phase 1 capture processing pipeline.

Covers 8 of the 11 nodes in the design doc (Section 12): summarize,
extract_entities, identify_project, detect_deadlines, detect_decisions,
detect_action_items/create_task_if_needed, generate_tags,
create_embeddings, link_related_notes. Combined into one structured
OpenAI call for everything up through generate_tags rather than seven
separate round trips - a real engineering simplification (they share the
same context and read better together), not a step reduction.
create_embeddings/link_related_notes are separate calls by necessity
(different API, needs the note to exist first to embed it).

Still not included, worth being explicit about rather than silently
dropping: detect_people (needs a real disambiguation strategy beyond
"extract a name" - matching "Sarah" across captures to the same person
entity reliably needs more than string equality, deferred rather than
shipped wrong). identify_project here is explicit-mention matching only
(the model picks from a list of existing project names/overviews) - the
design doc's fuller version adds embedding-similarity matching, which
would reuse the embedding infrastructure added in this pass but isn't
wired up yet.

Every run is logged to agent_actions (agent_name="pipeline"), including
when nothing gets created, matching the design doc's "why didn't this
become a task" auditability requirement.
"""

from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass
from datetime import date

import psycopg
from openai import OpenAI

# Configurable because "the current best small/cheap model" changes over
# time and shouldn't be hardcoded into a decision made once, today.
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
OPENAI_EMBEDDING_MODEL = os.environ.get(
    "OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"
)
# Must match embeddings.embedding's column type (vector(768)) in the
# migration. text-embedding-3-* models support the `dimensions` param to
# truncate their native (larger) output to this size.
EMBEDDING_DIMENSIONS = 768
# link_related_notes: cosine similarity threshold and cap - "capped at a
# small number of strongest links to keep the graph meaningful rather
# than dense" per the design doc.
RELATED_NOTES_THRESHOLD = 0.5
RELATED_NOTES_LIMIT = 5

_RESPONSE_SCHEMA = {
    "name": "capture_processing",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "A short (<=60 char) title for the note.",
            },
            "summary": {
                "type": "string",
                "description": "2-3 sentence summary of the capture.",
            },
            "tags": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Up to 5 short, reusable tags (lowercase, no '#').",
            },
            "entities": {
                "type": "array",
                "description": "People, organizations, or concepts explicitly named in the capture.",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "kind": {
                            "type": "string",
                            "enum": ["person", "organization", "concept"],
                        },
                    },
                    "required": ["name", "kind"],
                    "additionalProperties": False,
                },
            },
            "project_name_match": {
                "type": ["string", "null"],
                "description": "The exact name of an existing project this clearly belongs to, from the provided list only. Null if none confidently match.",
            },
            "is_decision": {
                "type": "boolean",
                "description": "True if the capture records a decision that was made (e.g. 'we chose', 'decided to', 'going with').",
            },
            "is_actionable": {
                "type": "boolean",
                "description": "True only if the capture describes something concrete and time-bound enough to act on.",
            },
            "task_title": {
                "type": ["string", "null"],
                "description": "Imperative task title if is_actionable, else null.",
            },
            "task_priority": {
                "type": ["integer", "null"],
                "description": "1 (highest) to 5 (lowest) if is_actionable, else null.",
            },
            "task_deadline": {
                "type": ["string", "null"],
                "description": "If is_actionable and a deadline is stated or implied (e.g. 'by Friday', 'next week'), resolve it to an absolute YYYY-MM-DD date relative to today's date given below. Null if none.",
            },
            "needs_review": {
                "type": "boolean",
                "description": "True if the capture is too ambiguous to confidently summarize/tag.",
            },
        },
        "required": [
            "title",
            "summary",
            "tags",
            "entities",
            "project_name_match",
            "is_decision",
            "is_actionable",
            "task_title",
            "task_priority",
            "task_deadline",
            "needs_review",
        ],
        "additionalProperties": False,
    },
}

_SYSTEM_PROMPT_TEMPLATE = (
    "You process raw personal notes/links for a second-brain app. Extract "
    "a title, a short summary, tags, named entities, and decide if the "
    "capture describes a concrete, actionable, time-bound task or records "
    "a decision. Be conservative: prefer needs_review=true over "
    "confidently inventing structure that isn't there, and prefer "
    "project_name_match=null over guessing at a project.\n\n"
    "Today's date is {today}, for resolving relative deadlines.\n"
    "Existing projects (match task_deadline null exactly against one of "
    "these names, or null if none fit): {projects}"
)


@dataclass
class PipelineResult:
    note_id: uuid.UUID
    task_id: uuid.UUID | None
    tags: list[str]
    entities: list[str]
    related_note_ids: list[uuid.UUID]
    needs_review: bool


def _extract(client: OpenAI, text: str, project_names: list[str]) -> dict:
    system_prompt = _SYSTEM_PROMPT_TEMPLATE.format(
        today=date.today().isoformat(),
        projects=", ".join(project_names) if project_names else "(none yet)",
    )
    response = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": text},
        ],
        response_format={"type": "json_schema", "json_schema": _RESPONSE_SCHEMA},
    )
    return json.loads(response.choices[0].message.content)


def _upsert_tag(cur: psycopg.Cursor, user_id: uuid.UUID, name: str) -> uuid.UUID:
    cur.execute(
        """
        insert into tags (user_id, name) values (%s, %s)
        on conflict (user_id, name) do update set name = excluded.name
        returning id
        """,
        (user_id, name),
    )
    return cur.fetchone()[0]


def _upsert_entity(
    cur: psycopg.Cursor, user_id: uuid.UUID, kind: str, name: str
) -> uuid.UUID:
    cur.execute(
        """
        insert into entities (user_id, kind, name) values (%s, %s, %s)
        on conflict (user_id, kind, name) do update set name = excluded.name
        returning id
        """,
        (user_id, kind, name),
    )
    return cur.fetchone()[0]


def _link(
    cur: psycopg.Cursor,
    user_id: uuid.UUID,
    source_type: str,
    source_id: uuid.UUID,
    target_type: str,
    target_id: uuid.UUID,
    relation_kind: str,
    weight: float = 1.0,
) -> None:
    cur.execute(
        """
        insert into relationships
            (user_id, source_type, source_id, target_type, target_id, relation_kind, weight)
        values (%s, %s, %s, %s, %s, %s, %s)
        """,
        (user_id, source_type, source_id, target_type, target_id, relation_kind, weight),
    )


def _embed_and_link_related_notes(
    conn: psycopg.Connection,
    client: OpenAI,
    user_id: uuid.UUID,
    note_id: uuid.UUID,
    content: str,
) -> list[uuid.UUID]:
    """create_embeddings + link_related_notes. Whole-note-as-one-chunk for
    now (chunk_index always 0) - real chunking for long documents is a
    further enhancement, not done here."""
    response = client.embeddings.create(
        model=OPENAI_EMBEDDING_MODEL,
        input=content,
        dimensions=EMBEDDING_DIMENSIONS,
    )
    embedding = response.data[0].embedding
    vector_literal = "[" + ",".join(str(x) for x in embedding) + "]"

    with conn.cursor() as cur:
        cur.execute(
            """
            insert into embeddings (user_id, content_type, content_id, chunk_index, chunk_text, embedding)
            values (%s, 'note', %s, 0, %s, %s::vector)
            """,
            (user_id, note_id, content, vector_literal),
        )

        cur.execute(
            """
            select content_id, 1 - (embedding <=> %s::vector) as similarity
            from embeddings
            where user_id = %s and content_type = 'note' and content_id != %s
            order by embedding <=> %s::vector
            limit %s
            """,
            (vector_literal, user_id, note_id, vector_literal, RELATED_NOTES_LIMIT),
        )
        related = [
            (target_id, similarity)
            for target_id, similarity in cur.fetchall()
            if similarity >= RELATED_NOTES_THRESHOLD
        ]

        for target_id, similarity in related:
            _link(cur, user_id, "note", note_id, "note", target_id, "relates_to", similarity)

    return [target_id for target_id, _ in related]


def process_capture(
    conn: psycopg.Connection,
    capture_id: uuid.UUID,
    client: OpenAI | None = None,
) -> PipelineResult:
    """Runs the pipeline for one capture. Raises on failure - the caller
    (worker.main.handle_job) is responsible for catching that and marking
    the capture 'failed' with pipeline_error, not this function."""
    client = client or OpenAI()

    with conn.cursor() as cur:
        cur.execute(
            "select user_id, kind, raw_text, source_url from captures where id = %s",
            (capture_id,),
        )
        row = cur.fetchone()
        if row is None:
            raise ValueError(f"capture {capture_id} not found")
        user_id, kind, raw_text, source_url = row

        cur.execute("select id, name from projects where user_id = %s", (user_id,))
        projects = cur.fetchall()

    text = raw_text or source_url or ""
    if not text.strip():
        raise ValueError(f"capture {capture_id} has no raw_text or source_url")

    project_by_name = {name: pid for pid, name in projects}
    extracted = _extract(client, text, list(project_by_name.keys()))
    project_id = project_by_name.get(extracted["project_name_match"] or "")

    with conn.cursor() as cur:
        cur.execute(
            """
            insert into notes (user_id, capture_id, project_id, title, content, ai_summary, note_type)
            values (%s, %s, %s, %s, %s, %s, %s)
            returning id
            """,
            (
                user_id,
                capture_id,
                project_id,
                extracted["title"],
                text,
                extracted["summary"],
                "decision" if extracted["is_decision"] else "note",
            ),
        )
        note_id = cur.fetchone()[0]

        for tag_name in extracted["tags"]:
            tag_id = _upsert_tag(cur, user_id, tag_name)
            cur.execute(
                """
                insert into taggables (tag_id, taggable_type, taggable_id)
                values (%s, 'note', %s)
                on conflict do nothing
                """,
                (tag_id, note_id),
            )

        entity_names = []
        for entity in extracted["entities"]:
            entity_id = _upsert_entity(cur, user_id, entity["kind"], entity["name"])
            _link(cur, user_id, "note", note_id, "entity", entity_id, "mentions")
            entity_names.append(entity["name"])

        task_id = None
        if extracted["is_actionable"] and extracted["task_title"]:
            cur.execute(
                """
                insert into tasks (user_id, project_id, capture_id, title, priority, deadline)
                values (%s, %s, %s, %s, %s, %s)
                returning id
                """,
                (
                    user_id,
                    project_id,
                    capture_id,
                    extracted["task_title"],
                    extracted["task_priority"] or 3,
                    extracted["task_deadline"],
                ),
            )
            task_id = cur.fetchone()[0]

        status = "needs_review" if extracted["needs_review"] else "organized"
        cur.execute(
            "update captures set status = %s, processed_at = now() where id = %s",
            (status, capture_id),
        )

        cur.execute(
            """
            insert into agent_actions
                (user_id, agent_name, action_kind, target_type, target_id, summary, detail)
            values (%s, 'pipeline', 'created', 'note', %s, %s, %s)
            """,
            (
                user_id,
                note_id,
                f"Organized capture into note{' and task' if task_id else ''}"
                f"{' (flagged for review)' if extracted['needs_review'] else ''}.",
                json.dumps({**extracted, "task_id": str(task_id) if task_id else None}),
            ),
        )

    conn.commit()

    related_note_ids = _embed_and_link_related_notes(conn, client, user_id, note_id, text)
    conn.commit()

    return PipelineResult(
        note_id=note_id,
        task_id=task_id,
        tags=extracted["tags"],
        entities=entity_names,
        related_note_ids=related_note_ids,
        needs_review=extracted["needs_review"],
    )
