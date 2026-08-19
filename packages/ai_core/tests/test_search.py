import os
import uuid

import psycopg
import pytest

from ai_core.search import hybrid_search

DATABASE_URL = os.environ["DATABASE_URL"]
TEST_USER_ID = "12121212-1212-1212-1212-121212121212"
OTHER_USER_ID = "13131313-1313-1313-1313-131313131313"


class FakeGeminiClient:
    """Stands in for ai_core.client.GeminiClient - hybrid_search only calls
    client.embeddings.create(...) (via ai_core.context.embed_query)."""

    def __init__(self, embedding: list[float]):
        self._embedding = embedding
        self.embeddings = self

    def create(self, **_kwargs):
        return type("EmbeddingResponse", (), {"embedding": self._embedding})


@pytest.fixture
def conn():
    with psycopg.connect(DATABASE_URL, autocommit=False) as connection:
        with connection.cursor() as cur:
            cur.execute(
                """
                insert into auth.users (id, email, encrypted_password)
                values (%s, 'phase4-search-test@example.com', 'x')
                on conflict (id) do nothing
                """,
                (TEST_USER_ID,),
            )
        connection.commit()
        yield connection
        with connection.cursor() as cur:
            cur.execute("delete from auth.users where id = %s", (TEST_USER_ID,))
        connection.commit()


def _insert_note(conn, user_id: str, title: str, content: str) -> uuid.UUID:
    with conn.cursor() as cur:
        cur.execute(
            "insert into notes (user_id, title, content) values (%s, %s, %s) returning id",
            (user_id, title, content),
        )
        note_id = cur.fetchone()[0]
    conn.commit()
    return note_id


def _insert_embedding(conn, user_id: str, content_type: str, content_id, vector: list[float], text: str):
    literal = "[" + ",".join(str(x) for x in vector) + "]"
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into embeddings (user_id, content_type, content_id, chunk_index, chunk_text, embedding)
            values (%s, %s, %s, 0, %s, %s::vector)
            """,
            (user_id, content_type, content_id, text, literal),
        )
    conn.commit()


def test_hybrid_search_finds_a_fulltext_only_match(conn):
    note_id = _insert_note(conn, TEST_USER_ID, "Redis vs Postgres caching", "Comparing options.")
    client = FakeGeminiClient([0.9] * 768)  # embeds nowhere near this note

    results = hybrid_search(conn, client, TEST_USER_ID, "Redis vs Postgres caching")

    matched = [r for r in results if r.content_id == note_id]
    assert len(matched) == 1
    assert matched[0].content_type == "note"
    assert matched[0].title == "Redis vs Postgres caching"


def test_hybrid_search_finds_a_vector_only_match(conn):
    note_id = _insert_note(conn, TEST_USER_ID, "Completely unrelated title", "Body text.")
    _insert_embedding(conn, TEST_USER_ID, "note", note_id, [0.5] * 768, "Body text.")
    client = FakeGeminiClient([0.5] * 768)  # identical vector, cosine similarity 1.0

    results = hybrid_search(conn, client, TEST_USER_ID, "something with no lexical overlap at all")

    matched = [r for r in results if r.content_id == note_id]
    assert len(matched) == 1


def test_hybrid_search_ranks_items_found_by_both_legs_above_single_leg_matches(conn):
    both_id = _insert_note(conn, TEST_USER_ID, "Investor update draft", "Body.")
    _insert_embedding(conn, TEST_USER_ID, "note", both_id, [0.7] * 768, "Body.")

    fulltext_only_id = _insert_note(conn, TEST_USER_ID, "Investor update notes", "Different body.")
    _insert_embedding(conn, TEST_USER_ID, "note", fulltext_only_id, [0.1] * 768, "Different body.")

    client = FakeGeminiClient([0.7] * 768)  # matches both_id's vector exactly

    results = hybrid_search(conn, client, TEST_USER_ID, "Investor update draft")

    ids_in_order = [r.content_id for r in results]
    assert ids_in_order.index(both_id) < ids_in_order.index(fulltext_only_id)


def test_hybrid_search_scopes_results_to_the_requesting_user(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into auth.users (id, email, encrypted_password)
            values (%s, 'phase4-search-other-test@example.com', 'x')
            on conflict (id) do nothing
            """,
            (OTHER_USER_ID,),
        )
    conn.commit()
    other_note_id = _insert_note(conn, OTHER_USER_ID, "Someone else's private plan", "Body.")
    client = FakeGeminiClient([0.2] * 768)

    try:
        results = hybrid_search(conn, client, TEST_USER_ID, "Someone else's private plan")
        assert other_note_id not in [r.content_id for r in results]
    finally:
        with conn.cursor() as cur:
            cur.execute("delete from auth.users where id = %s", (OTHER_USER_ID,))
        conn.commit()


def test_hybrid_search_returns_empty_for_a_blank_query(conn):
    client = FakeGeminiClient([0.1] * 768)

    results = hybrid_search(conn, client, TEST_USER_ID, "   ")

    assert results == []
