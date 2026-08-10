"""Memory agent (design doc Section 6): "retrieve then answer". The
simplest of the six graph shapes - no LangGraph dependency needed for a
two-step graph, same call made for the capture pipeline (packages/ai_core/
ai_core/pipeline.py's module docstring), so this doesn't reach for it
either. Streams tokens back for the FastAPI SSE endpoint to relay.

Citations are every context item retrieved, not a parsed record of what
the model's answer actually referenced - a reasonable reading of "cite
which notes/projects it drew from" (Section 2.10) without needing the
model to self-report citations in a structured format mid-stream, which
would fight against plain token streaming.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from dataclasses import dataclass

import psycopg
from ai_core.client import get_client, CHAT_MODEL

from ai_core.context import ContextResult, build_context


_SYSTEM_PROMPT = (
    "You are the Memory agent for a personal second-brain app. Answer the "
    "user's question using only the context below, drawn from their own "
    "notes, tasks, and projects. If the context doesn't contain the "
    "answer, say so plainly rather than guessing. When you use something "
    "from the context, cite it inline like [Note Title]."
)


@dataclass
class Citation:
    content_type: str
    content_id: uuid.UUID
    title: str


def _format_context(context: ContextResult) -> str:
    lines = [
        f"- ({item.content_type}) {item.title}"
        + (f": {item.text[:500]}" if item.text else "")
        for item in context.items
    ]
    if context.recent_actions:
        lines.append("\nRecent activity:")
        lines.extend(f"- {a}" for a in context.recent_actions)
    return "\n".join(lines) or "(nothing relevant found in this account yet)"


def query_memory_stream(
    conn: psycopg.Connection,
    client,
    user_id: uuid.UUID,
    query: str,
    history: list[dict[str, str]] | None = None,
) -> tuple[Iterator[str], list[Citation]]:
    context = build_context(conn, client, user_id, query)
    citations = [
        Citation(content_type=i.content_type, content_id=i.content_id, title=i.title)
        for i in context.items
    ]

    messages = [
        {
            "role": "system",
            "content": f"{_SYSTEM_PROMPT}\n\nContext:\n{_format_context(context)}",
        },
        *(history or []),
        {"role": "user", "content": query},
    ]

    stream = client.chat.completions.create(model=CHAT_MODEL, messages=messages, stream=True)

    def tokens() -> Iterator[str]:
        for chunk in stream:
            if chunk.content:
                yield chunk.content

    return tokens(), citations
