"""Phase 1 capture processing pipeline.

This is a deliberately scoped-down first slice of the 11-node pipeline in
the design doc (Section 12): summarize, generate_tags, and
detect_action_items/create_task_if_needed, combined into one structured
OpenAI call rather than four separate round trips - a real engineering
simplification, not a step reduction; note-creation, tagging, and a
task-or-not decision genuinely share the same context and read better
together than as sequential API calls. Not included yet, and worth being
explicit about rather than silently dropping: extract_entities,
identify_project, detect_people, detect_deadlines, detect_decisions,
create_embeddings, link_related_notes. Each needs either a real entity
store query (identify_project/detect_people) or an embeddings column
that isn't wired up yet (create_embeddings/link_related_notes) - adding
them as fake no-ops would be worse than leaving them out.

Every run is logged to agent_actions (agent_name="pipeline"), including
when nothing gets created, matching the design doc's "why didn't this
become a task" auditability requirement.
"""

from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass

import psycopg
from openai import OpenAI

# Configurable because "the current best small/cheap model" changes over
# time and shouldn't be hardcoded into a decision made once, today.
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

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
            "needs_review": {
                "type": "boolean",
                "description": "True if the capture is too ambiguous to confidently summarize/tag.",
            },
        },
        "required": [
            "title",
            "summary",
            "tags",
            "is_actionable",
            "task_title",
            "task_priority",
            "needs_review",
        ],
        "additionalProperties": False,
    },
}

_SYSTEM_PROMPT = (
    "You process raw personal notes/links for a second-brain app. Extract "
    "a title, a short summary, tags, and decide if the capture describes "
    "a concrete, actionable, time-bound task. Be conservative: prefer "
    "needs_review=true over confidently inventing structure that isn't there."
)


@dataclass
class PipelineResult:
    note_id: uuid.UUID
    task_id: uuid.UUID | None
    tags: list[str]
    needs_review: bool


def _extract(client: OpenAI, text: str) -> dict:
    response = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
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

    text = raw_text or source_url or ""
    if not text.strip():
        raise ValueError(f"capture {capture_id} has no raw_text or source_url")

    extracted = _extract(client, text)

    with conn.cursor() as cur:
        cur.execute(
            """
            insert into notes (user_id, capture_id, title, content, ai_summary)
            values (%s, %s, %s, %s, %s)
            returning id
            """,
            (user_id, capture_id, extracted["title"], text, extracted["summary"]),
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

        task_id = None
        if extracted["is_actionable"] and extracted["task_title"]:
            cur.execute(
                """
                insert into tasks (user_id, project_id, capture_id, title, priority)
                values (%s, null, %s, %s, %s)
                returning id
                """,
                (
                    user_id,
                    capture_id,
                    extracted["task_title"],
                    extracted["task_priority"] or 3,
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
    return PipelineResult(
        note_id=note_id,
        task_id=task_id,
        tags=extracted["tags"],
        needs_review=extracted["needs_review"],
    )
