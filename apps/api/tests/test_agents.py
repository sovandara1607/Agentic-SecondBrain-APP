import json
import os
import uuid

import psycopg
import pytest
from fastapi.testclient import TestClient

import routers.agents as agents_module
from core.auth import verify_jwt
from main import app

DATABASE_URL = os.environ["DATABASE_URL"]
TEST_USER_ID = "22222222-2222-2222-2222-222222222222"
OTHER_USER_ID = "33333333-3333-3333-3333-333333333333"


class FakeGeminiClient:
    """Stands in for ai_core.client.GeminiClient in the /agents/memory/stream endpoint -
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
                    yield type("ChatCompletion", (), {"content": token})
            return chunks()
        return type("EmbeddingResponse", (), {"embedding": [0.1] * 768})


class FakePlannerGeminiClient:
    """Stands in for ai_core.client.GeminiClient in /agents/planner/decompose - only
    chat.completions.create(..., response_format=json_schema) is called,
    reading response.content as a JSON string."""

    def __init__(self, plan: dict):
        self._plan = plan
        self.chat = self
        self.completions = self

    def create(self, **_kwargs):
        return type("ChatCompletion", (), {"content": json.dumps(self._plan)})


ONE_GROUP_PLAN = {
    "groups": [
        {
            "name": "Planning",
            "depends_on_groups": [],
            "tasks": [
                {"title": "Define MVP scope", "estimated_minutes": 60, "energy_level": "high", "priority": 1},
            ],
        },
    ]
}


class BlowingUpGeminiClient:
    """Simulates a client whose failure message would leak internals -
    real psycopg/gemini exceptions can embed connection strings, secrets,
    or other backend details in str(exc)."""

    def __init__(self):
        self.chat = self
        self.completions = self
        self.embeddings = self

    def create(self, **kwargs):
        raise RuntimeError(
            "connection to postgresql://postgres:super-secret-pw@db:5432/postgres failed"
        )


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
            cur.execute(
                """
                insert into auth.users (id, email, encrypted_password)
                values (%s, 'phase3-agents-endpoint-other-test@example.com', 'x')
                on conflict (id) do nothing
                """,
                (OTHER_USER_ID,),
            )
        connection.commit()
        yield connection
        with connection.cursor() as cur:
            cur.execute(
                "delete from auth.users where id in (%s, %s)", (TEST_USER_ID, OTHER_USER_ID)
            )
        connection.commit()


@pytest.fixture
def client(conn, monkeypatch):
    monkeypatch.setattr(agents_module, "get_client", lambda: FakeGeminiClient(["Hi ", "there."]))
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


def test_memory_stream_error_message_never_leaks_exception_internals(conn, monkeypatch):
    monkeypatch.setattr(agents_module, "get_client", lambda: BlowingUpGeminiClient())
    app.dependency_overrides[verify_jwt] = lambda: TEST_USER_ID
    try:
        response = TestClient(app).post("/agents/memory/stream", json={"query": "hi"})
        events = _parse_events(response.text)
        error_event = next(e for e in events if e["type"] == "error")
        assert "super-secret-pw" not in error_event["message"]
        assert "postgresql://" not in error_event["message"]
    finally:
        app.dependency_overrides.pop(verify_jwt, None)


def test_memory_stream_rejects_conversation_owned_by_another_user(client, conn):
    with conn.cursor() as cur:
        cur.execute(
            "insert into conversations (user_id, title) values (%s, 'not yours') returning id",
            (OTHER_USER_ID,),
        )
        other_conversation_id = str(cur.fetchone()[0])
    conn.commit()

    response = client.post(
        "/agents/memory/stream",
        json={"query": "let me in", "conversation_id": other_conversation_id},
    )

    assert response.status_code == 404
    with conn.cursor() as cur:
        cur.execute(
            "select count(*) from messages where conversation_id = %s", (other_conversation_id,)
        )
        count = cur.fetchone()[0]
    assert count == 0


def _insert_project(conn, user_id: str, name: str = "MyLMS") -> str:
    with conn.cursor() as cur:
        cur.execute(
            "insert into projects (user_id, name) values (%s, %s) returning id", (user_id, name)
        )
        project_id = str(cur.fetchone()[0])
    conn.commit()
    return project_id


def test_planner_decompose_creates_tasks(conn, monkeypatch):
    monkeypatch.setattr(agents_module, "get_client", lambda: FakePlannerGeminiClient(ONE_GROUP_PLAN))
    app.dependency_overrides[verify_jwt] = lambda: TEST_USER_ID
    project_id = _insert_project(conn, TEST_USER_ID)

    try:
        response = TestClient(app).post(
            "/agents/planner/decompose",
            json={"project_id": project_id, "goal": "Launch MyLMS"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["total_tasks"] == 1
        assert body["groups"][0]["name"] == "Planning"

        with conn.cursor() as cur:
            cur.execute("select count(*) from tasks where project_id = %s", (project_id,))
            assert cur.fetchone()[0] == 1
    finally:
        app.dependency_overrides.pop(verify_jwt, None)


def test_planner_decompose_rejects_project_owned_by_another_user(conn, monkeypatch):
    monkeypatch.setattr(agents_module, "get_client", lambda: FakePlannerGeminiClient(ONE_GROUP_PLAN))
    app.dependency_overrides[verify_jwt] = lambda: TEST_USER_ID
    other_project_id = _insert_project(conn, OTHER_USER_ID, "Not yours")

    try:
        response = TestClient(app).post(
            "/agents/planner/decompose",
            json={"project_id": other_project_id, "goal": "Launch MyLMS"},
        )
        assert response.status_code == 404
        with conn.cursor() as cur:
            cur.execute("select count(*) from tasks where project_id = %s", (other_project_id,))
            assert cur.fetchone()[0] == 0
    finally:
        app.dependency_overrides.pop(verify_jwt, None)


def test_planner_decompose_rejects_invalid_project_id(conn, monkeypatch):
    monkeypatch.setattr(agents_module, "get_client", lambda: FakePlannerGeminiClient(ONE_GROUP_PLAN))
    app.dependency_overrides[verify_jwt] = lambda: TEST_USER_ID

    try:
        response = TestClient(app).post(
            "/agents/planner/decompose",
            json={"project_id": "not-a-uuid", "goal": "Launch MyLMS"},
        )
        assert response.status_code == 400
    finally:
        app.dependency_overrides.pop(verify_jwt, None)


def test_planner_decompose_requires_auth():
    app.dependency_overrides.pop(verify_jwt, None)
    response = TestClient(app).post(
        "/agents/planner/decompose", json={"project_id": str(uuid.uuid4()), "goal": "hi"}
    )
    assert response.status_code in (401, 403)
