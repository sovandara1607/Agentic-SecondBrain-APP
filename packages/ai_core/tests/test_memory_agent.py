import os
import uuid

import psycopg
import pytest

from ai_core.agents.memory import query_memory_stream

DATABASE_URL = os.environ["DATABASE_URL"]
TEST_USER_ID = "88888888-8888-8888-8888-888888888888"


class FakeGeminiClient:
    """Stands in for ai_core.client.GeminiClient - query_memory_stream only calls
    client.embeddings.create(...) (via ai_core.context.build_context) and
    client.chat.completions.create(..., stream=True) (reading a stream of
    chunks each with .content attribute)."""

    def __init__(self, embedding: list[float], reply_tokens: list[str]):
        self._embedding = embedding
        self._reply_tokens = reply_tokens
        self.chat = self
        self.completions = self
        self.embeddings = self

    def create(self, **kwargs):
        if "messages" in kwargs:
            def chunks():
                for token in self._reply_tokens:
                    yield type("ChatCompletion", (), {"content": token})
            return chunks()
        return type("EmbeddingResponse", (), {"embedding": self._embedding})


@pytest.fixture
def conn():
    with psycopg.connect(DATABASE_URL, autocommit=False) as connection:
        with connection.cursor() as cur:
            cur.execute(
                """
                insert into auth.users (id, email, encrypted_password)
                values (%s, 'phase3-memory-agent-test@example.com', 'x')
                on conflict (id) do nothing
                """,
                (TEST_USER_ID,),
            )
        connection.commit()
        yield connection
        with connection.cursor() as cur:
            cur.execute("delete from auth.users where id = %s", (TEST_USER_ID,))
        connection.commit()


def _insert_note_with_embedding(conn, title: str, content: str, vector: list[float]) -> uuid.UUID:
    with conn.cursor() as cur:
        cur.execute(
            "insert into notes (user_id, title, content) values (%s, %s, %s) returning id",
            (TEST_USER_ID, title, content),
        )
        note_id = cur.fetchone()[0]
        literal = "[" + ",".join(str(x) for x in vector) + "]"
        cur.execute(
            """
            insert into embeddings (user_id, content_type, content_id, chunk_index, chunk_text, embedding)
            values (%s, 'note', %s, 0, %s, %s::vector)
            """,
            (TEST_USER_ID, note_id, content, literal),
        )
    conn.commit()
    return note_id


def test_query_memory_stream_yields_tokens_and_citations(conn):
    note_id = _insert_note_with_embedding(conn, "Launch plan", "Ship by Friday", [0.4] * 768)
    client = FakeGeminiClient([0.4] * 768, ["The ", "launch ", "is ", "Friday."])

    tokens, citations = query_memory_stream(conn, client, TEST_USER_ID, "when do we launch?")

    assert "".join(tokens) == "The launch is Friday."
    assert len(citations) == 1
    assert citations[0].content_id == note_id
    assert citations[0].title == "Launch plan"


def test_query_memory_stream_handles_no_context(conn):
    client = FakeGeminiClient([0.1] * 768, ["I ", "don't ", "know."])

    tokens, citations = query_memory_stream(conn, client, TEST_USER_ID, "anything at all?")

    assert "".join(tokens) == "I don't know."
    assert citations == []


def test_query_memory_stream_passes_history_through(conn):
    client = FakeGeminiClient([0.2] * 768, ["Sure."])
    history = [
        {"role": "user", "content": "What is my name?"},
        {"role": "assistant", "content": "You haven't told me."},
    ]

    tokens, _citations = query_memory_stream(
        conn, client, TEST_USER_ID, "ok never mind", history=history
    )

    assert "".join(tokens) == "Sure."
