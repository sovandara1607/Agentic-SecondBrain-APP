import os
import uuid

import psycopg
import pytest

from ai_core.context import build_context

DATABASE_URL = os.environ["DATABASE_URL"]
TEST_USER_ID = "99999999-9999-9999-9999-999999999999"


class FakeGeminiClient:
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
                values (%s, 'phase3-context-test@example.com', 'x')
                on conflict (id) do nothing
                """,
                (TEST_USER_ID,),
            )
        connection.commit()
        yield connection
        with connection.cursor() as cur:
            cur.execute("delete from auth.users where id = %s", (TEST_USER_ID,))
        connection.commit()


def _insert_note(conn, title: str, content: str) -> uuid.UUID:
    with conn.cursor() as cur:
        cur.execute(
            "insert into notes (user_id, title, content) values (%s, %s, %s) returning id",
            (TEST_USER_ID, title, content),
        )
        note_id = cur.fetchone()[0]
    conn.commit()
    return note_id


def _insert_embedding(conn, note_id: uuid.UUID, vector: list[float]) -> None:
    literal = "[" + ",".join(str(x) for x in vector) + "]"
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into embeddings (user_id, content_type, content_id, chunk_index, chunk_text, embedding)
            values (%s, 'note', %s, 0, 'chunk', %s::vector)
            """,
            (TEST_USER_ID, note_id, literal),
        )
    conn.commit()


def test_build_context_finds_closest_match_via_vector_search(conn):
    close_id = _insert_note(conn, "Close match", "relevant content")
    far_id = _insert_note(conn, "Far match", "unrelated content")
    _insert_embedding(conn, close_id, [0.9] * 768)
    _insert_embedding(conn, far_id, [-0.9] * 768)

    result = build_context(conn, FakeGeminiClient([0.9] * 768), TEST_USER_ID, "anything", k=1)

    assert len(result.items) == 1
    assert result.items[0].content_id == close_id
    assert result.items[0].title == "Close match"
    assert result.items[0].similarity > 0.99


def test_build_context_traverses_relationships_two_hops(conn):
    seed_id = _insert_note(conn, "Seed note", "seed content")
    depth1_id = _insert_note(conn, "Depth one note", "depth one content")
    depth2_id = _insert_note(conn, "Depth two note", "depth two content")
    _insert_embedding(conn, seed_id, [0.5] * 768)

    with conn.cursor() as cur:
        cur.execute(
            """
            insert into relationships (user_id, source_type, source_id, target_type, target_id, relation_kind)
            values (%s, 'note', %s, 'note', %s, 'mentions')
            """,
            (TEST_USER_ID, seed_id, depth1_id),
        )
        cur.execute(
            """
            insert into relationships (user_id, source_type, source_id, target_type, target_id, relation_kind)
            values (%s, 'note', %s, 'note', %s, 'mentions')
            """,
            (TEST_USER_ID, depth1_id, depth2_id),
        )
    conn.commit()

    result = build_context(conn, FakeGeminiClient([0.5] * 768), TEST_USER_ID, "anything", k=1)

    found_ids = {item.content_id for item in result.items}
    assert seed_id in found_ids
    assert depth1_id in found_ids
    assert depth2_id in found_ids


def test_build_context_includes_recent_agent_actions(conn):
    note_id = _insert_note(conn, "A note", "content")
    _insert_embedding(conn, note_id, [0.3] * 768)
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into agent_actions (user_id, agent_name, action_kind, summary)
            values (%s, 'pipeline', 'created', 'Organized a capture into a note.')
            """,
            (TEST_USER_ID,),
        )
    conn.commit()

    result = build_context(conn, FakeGeminiClient([0.3] * 768), TEST_USER_ID, "anything")

    assert any("Organized a capture" in a for a in result.recent_actions)
