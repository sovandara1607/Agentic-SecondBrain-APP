"""Writer agent (design doc Section 6): "outline, draft, refine" - drafts
a document (email, report, presentation outline) from the user's own
context, per Section 2.10's "generate a presentation from my notes" and
"generate interview answers from my experiences" AI Workspace examples.

Reuses the same context_builder as Memory (Section 6: "All 6 agents ...
sharing one context-builder step") rather than a separate retrieval path,
so a Writer draft is grounded in the same notes/tasks/projects a Memory
answer would cite.

"Reads notes, projects | writes draft notes only" (Section 6's agent
table): every draft is persisted as a `notes` row (note_type: 'summary',
the closest existing type to "AI-generated document" - there's no
dedicated `draft` note_type in the schema and adding one is a bigger
change than this agent needs). "Outline, draft, refine" is one graph
shape iterated, not three separate ones: passing `existing_note_id`
seeds the prompt with the current draft and asks for a revision, updating
that note in place instead of creating a new one.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass

import psycopg
from ai_core.client import CHAT_MODEL
from ai_core.context import build_context
from ai_core.i18n import language_suffix

_SYSTEM_PROMPT = (
    "You are the Writer agent for a personal second-brain app. Draft the "
    "requested document in clean markdown, grounded only in the context "
    "below (the user's own notes, tasks, and projects) plus general "
    "writing craft - don't invent facts about the user's work that "
    "aren't in the context. If the context doesn't cover something the "
    "request needs, write around the gap rather than fabricating detail. "
    "Start with a single markdown H1 title line."
)

DOC_TYPES = {"email", "report", "presentation_outline", "document"}


class NoteNotFoundError(ValueError):
    pass


@dataclass
class WriterResult:
    note_id: uuid.UUID
    title: str
    content: str
    doc_type: str
    action: str  # "created" | "updated"


def _fetch_existing_draft(cur, user_id: uuid.UUID, note_id: uuid.UUID) -> tuple[str, str]:
    cur.execute(
        "select title, content from notes where id = %s and user_id = %s",
        (note_id, user_id),
    )
    row = cur.fetchone()
    if row is None:
        raise NoteNotFoundError(f"note {note_id} not found for this user")
    return row


def _format_context(items) -> str:
    lines = [
        f"- ({item.content_type}) {item.title}" + (f": {item.text[:500]}" if item.text else "")
        for item in items
    ]
    return "\n".join(lines) or "(nothing relevant found in this account yet)"


def draft_document(
    conn: psycopg.Connection,
    client,
    user_id: uuid.UUID,
    prompt: str,
    doc_type: str = "document",
    existing_note_id: uuid.UUID | None = None,
    language: str = "en",
) -> WriterResult:
    doc_type = doc_type if doc_type in DOC_TYPES else "document"

    existing_title = None
    existing_content = None
    if existing_note_id is not None:
        with conn.cursor() as cur:
            existing_title, existing_content = _fetch_existing_draft(cur, user_id, existing_note_id)

    context = build_context(conn, client, user_id, prompt)

    user_message = f"Context:\n{_format_context(context.items)}\n\nRequest ({doc_type}): {prompt}"
    if existing_content:
        user_message += (
            f"\n\nRevise this existing draft rather than starting over:\n\n{existing_content}"
        )

    response = client.chat.completions.create(
        model=CHAT_MODEL,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT + language_suffix(language)},
            {"role": "user", "content": user_message},
        ],
    )
    content = (response.content or "").strip()
    title = existing_title or (content.splitlines()[0].lstrip("# ").strip()[:120] if content else prompt[:120])

    with conn.cursor() as cur:
        if existing_note_id is not None:
            cur.execute(
                "update notes set title = %s, content = %s, updated_at = now() where id = %s returning id",
                (title, content, existing_note_id),
            )
            note_id = cur.fetchone()[0]
            action = "updated"
        else:
            cur.execute(
                """
                insert into notes (user_id, title, content, note_type)
                values (%s, %s, %s, 'summary')
                returning id
                """,
                (user_id, title, content),
            )
            note_id = cur.fetchone()[0]
            action = "created"

        cur.execute(
            """
            insert into agent_actions
                (user_id, agent_name, action_kind, target_type, target_id, summary, detail)
            values (%s, 'writer', %s, 'note', %s, %s, %s)
            """,
            (
                user_id,
                action,
                note_id,
                f"{'Revised' if action == 'updated' else 'Drafted'} a {doc_type}: {title}",
                json.dumps({"doc_type": doc_type, "prompt": prompt}),
            ),
        )

    conn.commit()
    return WriterResult(note_id=note_id, title=title, content=content, doc_type=doc_type, action=action)
