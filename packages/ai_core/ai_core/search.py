"""Hybrid search (design doc Section 7): a pgvector similarity leg and a
pg_trgm full-text leg, combined via reciprocal rank fusion (RRF) so an
exact keyword hit and a semantic match both surface - neither leg's
ranking dominates unconditionally, which is the whole point of doing this
client-side (in FastAPI, per Section 7) instead of just picking one.

pg_trgm over tsvector for the full-text leg: both are named as options in
Section 7, trigram similarity was picked for typo/partial-match tolerance
on short titles (someone searching "pstgres" should still find "Redis vs
Postgres") without needing a language-specific tsvector column added to
every searchable table.

RRF formula: for each leg, score += 1 / (RRF_K + rank), rank 0-based
within that leg. An item found by only one leg still scores something (no
zero-vs-nonzero cliff at the union boundary); an item found by both legs
outranks one found by either alone, without either leg's raw score scale
(cosine similarity vs trigram similarity - not comparable numbers)
needing to be normalized against the other.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

import psycopg
from ai_core.context import CONTENT_TABLES, embed_query, title_for

VECTOR_LIMIT = 20
FULLTEXT_LIMIT = 20
FULLTEXT_TRIGRAM_THRESHOLD = 0.15
RRF_K = 60
DEFAULT_RESULT_LIMIT = 20


@dataclass
class SearchResult:
    content_type: str
    content_id: uuid.UUID
    title: str
    snippet: str
    score: float


def _vector_leg(
    cur: psycopg.Cursor, user_id: uuid.UUID, embedding: list[float]
) -> list[tuple[str, uuid.UUID, str]]:
    vector_literal = "[" + ",".join(str(x) for x in embedding) + "]"
    cur.execute(
        """
        select content_type, content_id, chunk_text
        from embeddings
        where user_id = %s
        order by embedding <=> %s::vector
        limit %s
        """,
        (user_id, vector_literal, VECTOR_LIMIT),
    )
    return cur.fetchall()  # best-first


def _fulltext_leg(
    cur: psycopg.Cursor, user_id: uuid.UUID, query: str
) -> list[tuple[str, uuid.UUID, str]]:
    # One UNION ALL across every searchable table (mirrors CONTENT_TABLES'
    # coverage, minus meetings which have no title/body of their own to
    # match against - Section 7's "notes.title + content, tasks.title,
    # etc." list), scored by the best trigram similarity across that
    # row's title and body, so a hit in either counts.
    cur.execute(
        """
        select content_type, content_id, snippet from (
            select 'note' as content_type, id as content_id,
                   left(coalesce(content, ''), 300) as snippet,
                   greatest(similarity(title, %(q)s), similarity(coalesce(content, ''), %(q)s)) as sim
            from notes where user_id = %(user_id)s
            union all
            select 'task', id, coalesce(context, ''), similarity(title, %(q)s)
            from tasks where user_id = %(user_id)s
            union all
            select 'project', id, coalesce(overview, ''),
                   greatest(similarity(name, %(q)s), similarity(coalesce(overview, ''), %(q)s))
            from projects where user_id = %(user_id)s
            union all
            select 'document', id, left(coalesce(extracted_text, ''), 300), similarity(title, %(q)s)
            from documents where user_id = %(user_id)s
        ) matches
        where sim >= %(threshold)s
        order by sim desc
        limit %(limit)s
        """,
        {
            "q": query,
            "user_id": user_id,
            "threshold": FULLTEXT_TRIGRAM_THRESHOLD,
            "limit": FULLTEXT_LIMIT,
        },
    )
    return cur.fetchall()  # best-first


def hybrid_search(
    conn: psycopg.Connection,
    client,
    user_id: uuid.UUID,
    query: str,
    limit: int = DEFAULT_RESULT_LIMIT,
) -> list[SearchResult]:
    if not query.strip():
        return []

    embedding = embed_query(client, query)
    with conn.cursor() as cur:
        vector_rows = _vector_leg(cur, user_id, embedding)
        fulltext_rows = _fulltext_leg(cur, user_id, query)

        rrf_scores: dict[tuple[str, uuid.UUID], float] = {}
        snippets: dict[tuple[str, uuid.UUID], str] = {}
        for rank, (content_type, content_id, snippet) in enumerate(vector_rows):
            if content_type not in CONTENT_TABLES:
                continue
            key = (content_type, content_id)
            rrf_scores[key] = rrf_scores.get(key, 0.0) + 1.0 / (RRF_K + rank)
            snippets.setdefault(key, snippet)
        for rank, (content_type, content_id, snippet) in enumerate(fulltext_rows):
            key = (content_type, content_id)
            rrf_scores[key] = rrf_scores.get(key, 0.0) + 1.0 / (RRF_K + rank)
            snippets.setdefault(key, snippet)

        ranked = sorted(rrf_scores.items(), key=lambda kv: kv[1], reverse=True)[:limit]

        return [
            SearchResult(
                content_type=content_type,
                content_id=content_id,
                title=title_for(cur, content_type, content_id),
                snippet=(snippets.get((content_type, content_id)) or "")[:280],
                score=score,
            )
            for (content_type, content_id), score in ranked
        ]
