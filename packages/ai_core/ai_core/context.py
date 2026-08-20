"""Section 6's context builder: given a query, runs a pgvector similarity
search over embeddings (top-k), a depth-2 traversal of relationships from
whatever matched, and pulls the last N agent_actions for continuity.
Shared by every agent (Memory today; Planner/Writer/Review/Workflow reuse
this unchanged when they're built).

Depth-2 traversal here means: relationships directly touching a top-k
match (depth 1), plus relationships touching *those* related items
(depth 2) - capped at MAX_CONTEXT_ITEMS total so a densely-connected graph
can't blow up the prompt. "Depth 2" isn't a literal graph-distance
guarantee for every item (a depth-2 item found via multiple paths is only
counted once, first path wins) - bounded and good enough for grounding a
chat answer, not a full graph query engine.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

import psycopg
from ai_core.client import EMBEDDING_DIMENSIONS, EMBEDDING_MODEL

VECTOR_TOP_K = 10
MAX_CONTEXT_ITEMS = 20
RECENT_AGENT_ACTIONS = 5

# content_type -> (table, title-ish column) for resolving a matched
# embedding chunk back to something a prompt/citation can name.
CONTENT_TABLES = {
    "note": ("notes", "title"),
    "task": ("tasks", "title"),
    "project": ("projects", "name"),
    "document": ("documents", "title"),
    "meeting": ("meetings", None),  # meetings have no title of their own
}


@dataclass
class ContextItem:
    content_type: str
    content_id: uuid.UUID
    title: str
    text: str
    similarity: float | None = None


@dataclass
class ContextResult:
    items: list[ContextItem] = field(default_factory=list)
    recent_actions: list[str] = field(default_factory=list)


def embed_query(client, query: str) -> list[float]:
    response = client.embeddings.create(
        model=EMBEDDING_MODEL, input=query, dimensions=EMBEDDING_DIMENSIONS
    )
    return response.embedding


def title_for(cur: psycopg.Cursor, content_type: str, content_id: uuid.UUID) -> str:
    table, column = CONTENT_TABLES.get(content_type, (None, None))
    if table is None or column is None:
        return content_type
    cur.execute(f"select {column} from {table} where id = %s", (content_id,))  # noqa: S608 - content_type is our own fixed lookup table, not user input
    row = cur.fetchone()
    return row[0] if row else content_type


def _vector_search(
    cur: psycopg.Cursor, user_id: uuid.UUID, embedding: list[float], k: int
) -> list[ContextItem]:
    vector_literal = "[" + ",".join(str(x) for x in embedding) + "]"
    cur.execute(
        """
        select content_type, content_id, chunk_text, 1 - (embedding <=> %s::vector) as similarity
        from embeddings
        where user_id = %s
        order by embedding <=> %s::vector
        limit %s
        """,
        (vector_literal, user_id, vector_literal, k),
    )
    items = []
    for content_type, content_id, chunk_text, similarity in cur.fetchall():
        items.append(
            ContextItem(
                content_type=content_type,
                content_id=content_id,
                title=title_for(cur, content_type, content_id),
                text=chunk_text,
                similarity=similarity,
            )
        )
    return items


def _traverse_relationships(
    cur: psycopg.Cursor,
    user_id: uuid.UUID,
    seeds: list[tuple[str, uuid.UUID]],
    seen: set[tuple[str, uuid.UUID]],
    limit: int,
) -> list[ContextItem]:
    if not seeds or limit <= 0:
        return []
    found: list[ContextItem] = []
    for content_type, content_id in seeds:
        if len(found) >= limit:
            break
        cur.execute(
            """
            select target_type, target_id from relationships
            where user_id = %s and source_type = %s and source_id = %s
            union
            select source_type, source_id from relationships
            where user_id = %s and target_type = %s and target_id = %s
            """,
            (user_id, content_type, content_id, user_id, content_type, content_id),
        )
        for related_type, related_id in cur.fetchall():
            key = (related_type, related_id)
            if key in seen or related_type not in CONTENT_TABLES:
                continue
            seen.add(key)
            found.append(
                ContextItem(
                    content_type=related_type,
                    content_id=related_id,
                    title=title_for(cur, related_type, related_id),
                    text="",
                )
            )
            if len(found) >= limit:
                break
    return found


def build_context(
    conn: psycopg.Connection,
    client,
    user_id: uuid.UUID,
    query: str,
    k: int = VECTOR_TOP_K,
) -> ContextResult:
    embedding = embed_query(client, query)
    with conn.cursor() as cur:
        depth1 = _vector_search(cur, user_id, embedding, k)
        seen = {(item.content_type, item.content_id) for item in depth1}

        remaining = MAX_CONTEXT_ITEMS - len(depth1)
        depth1_related = _traverse_relationships(
            cur, user_id, [(i.content_type, i.content_id) for i in depth1], seen, remaining
        )

        remaining -= len(depth1_related)
        depth2_related = _traverse_relationships(
            cur,
            user_id,
            [(i.content_type, i.content_id) for i in depth1_related],
            seen,
            remaining,
        )

        cur.execute(
            """
            select agent_name, summary from agent_actions
            where user_id = %s
            order by created_at desc
            limit %s
            """,
            (user_id, RECENT_AGENT_ACTIONS),
        )
        recent_actions = [f"{agent}: {summary}" for agent, summary in cur.fetchall()]

    return ContextResult(
        items=depth1 + depth1_related + depth2_related,
        recent_actions=recent_actions,
    )
