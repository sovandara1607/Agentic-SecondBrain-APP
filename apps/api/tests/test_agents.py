import json
import os

import psycopg
import pytest
from fastapi.testclient import TestClient

import routers.agents as agents_module
from core.auth import verify_jwt
from main import app

DATABASE_URL = os.environ["DATABASE_URL"]
TEST_USER_ID = "22222222-2222-2222-2222-222222222222"


class FakeOpenAI:
    """Stands in for openai.OpenAI in the /agents/memory/stream endpoint -
    only chat.completions.create(..., stream=True) and embeddings.create(...)
    are called."""

    def __init__(self, reply_tokens: list[str]):
        self._reply_tokens = reply_tokens
        self.chat = self
        self.completions = self
        self.embeddings = self

    def create(self, **kwargs):
        if "messages" in kwargs:
            def chunks():
                for token in self._reply_tokens:
                    delta = type("Delta", (), {"content": token})
                    choice = type("Choice", (), {"delta": delta})
                    yield type("Chunk", (), {"choices": [choice]})
            return chunks()
        item = type("Item", (), {"embedding": [0.1] * 768})
        return type("Response", (), {"data": [item]})


@pytest.fixture
def conn():
    with psycopg.connect(DATABASE_URL, autocommit=False) as connection:
        with connection.cursor() as cur:
            cur.execute(
                """
                insert into auth.users (id, email, encrypted_password)
                values (%s, 'phase3-agents-endpoint-test@example.com', 'x')
                on conflict (id) do nothing
                """,
                (TEST_USER_ID,),
            )
        connection.commit()
        yield connection
        with connection.cursor() as cur:
            cur.execute("delete from auth.users where id = %s", (TEST_USER_ID,))
        connection.commit()


@pytest.fixture
def client(conn, monkeypatch):
    monkeypatch.setattr(agents_module, "OpenAI", lambda: FakeOpenAI(["Hi ", "there."]))
    app.dependency_overrides[verify_jwt] = lambda: TEST_USER_ID
    yield TestClient(app)
    app.dependency_overrides.pop(verify_jwt, None)


def _parse_events(body: str) -> list[dict]:
    events = []
    for line in body.splitlines():
        if line.startswith("data: "):
            events.append(json.loads(line[len("data: "):]))
    return events


def test_memory_stream_creates_conversation_streams_tokens_and_persists_messages(client, conn):
    response = client.post("/agents/memory/stream", json={"query": "what's up?"})

    assert response.status_code == 200
    events = _parse_events(response.text)

    assert events[0]["type"] == "conversation"
    conversation_id = events[0]["id"]

    token_events = [e for e in events if e["type"] == "token"]
    assert "".join(e["text"] for e in token_events) == "Hi there."

    assert events[-1]["type"] == "done"
    citations_event = next(e for e in events if e["type"] == "citations")
    assert citations_event["citations"] == []

    with conn.cursor() as cur:
        cur.execute(
            "select role, content from messages where conversation_id = %s order by created_at",
            (conversation_id,),
        )
        rows = cur.fetchall()
    assert rows == [("user", "what's up?"), ("assistant", "Hi there.")]


def test_memory_stream_reuses_existing_conversation(client, conn):
    first = client.post("/agents/memory/stream", json={"query": "first question"})
    conversation_id = _parse_events(first.text)[0]["id"]

    second = client.post(
        "/agents/memory/stream",
        json={"query": "second question", "conversation_id": conversation_id},
    )
    events = _parse_events(second.text)

    assert events[0] == {"type": "conversation", "id": conversation_id}
    with conn.cursor() as cur:
        cur.execute(
            "select count(*) from messages where conversation_id = %s", (conversation_id,)
        )
        count = cur.fetchone()[0]
    assert count == 4


def test_memory_stream_requires_auth():
    app.dependency_overrides.pop(verify_jwt, None)
    response = TestClient(app).post("/agents/memory/stream", json={"query": "hi"})
    assert response.status_code in (401, 403)
