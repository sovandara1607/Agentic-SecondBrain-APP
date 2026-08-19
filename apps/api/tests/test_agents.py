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


class FakeReviewGeminiClient:
    """Stands in for ai_core.client.GeminiClient in /agents/review/daily - only
    chat.completions.create(..., response_format=json_schema) is called,
    reading response.content as a JSON string."""

    def __init__(self, priorities: list[str]):
        self._priorities = priorities
        self.chat = self
        self.completions = self

    def create(self, **_kwargs):
        return type("ChatCompletion", (), {"content": json.dumps({"priorities": self._priorities})})


def test_review_daily_generates_and_persists_a_review(conn, monkeypatch):
    monkeypatch.setattr(agents_module, "get_client", lambda: FakeReviewGeminiClient(["Rest up"]))
    app.dependency_overrides[verify_jwt] = lambda: TEST_USER_ID
    project_id = _insert_project(conn, TEST_USER_ID)
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into tasks (user_id, project_id, title, status, completed_at)
            values (%s, %s, 'Ship it', 'done', now())
            """,
            (TEST_USER_ID, project_id),
        )
    conn.commit()

    try:
        response = TestClient(app).post("/agents/review/daily", json={})
        assert response.status_code == 200
        body = response.json()
        assert len(body["completed_tasks"]) == 1
        assert body["tomorrow_priorities"] == ["Rest up"]

        with conn.cursor() as cur:
            cur.execute("select count(*) from daily_reviews where user_id = %s", (TEST_USER_ID,))
            assert cur.fetchone()[0] == 1
    finally:
        app.dependency_overrides.pop(verify_jwt, None)
        with conn.cursor() as cur:
            cur.execute("delete from daily_reviews where user_id = %s", (TEST_USER_ID,))
        conn.commit()


def test_review_daily_accepts_an_explicit_review_date(conn, monkeypatch):
    monkeypatch.setattr(agents_module, "get_client", lambda: FakeReviewGeminiClient([]))
    app.dependency_overrides[verify_jwt] = lambda: TEST_USER_ID

    try:
        response = TestClient(app).post("/agents/review/daily", json={"review_date": "2026-08-01"})
        assert response.status_code == 200
        assert response.json()["review_date"] == "2026-08-01"
    finally:
        app.dependency_overrides.pop(verify_jwt, None)
        with conn.cursor() as cur:
            cur.execute("delete from daily_reviews where user_id = %s", (TEST_USER_ID,))
        conn.commit()


def test_review_daily_rejects_invalid_review_date(conn, monkeypatch):
    monkeypatch.setattr(agents_module, "get_client", lambda: FakeReviewGeminiClient([]))
    app.dependency_overrides[verify_jwt] = lambda: TEST_USER_ID

    try:
        response = TestClient(app).post("/agents/review/daily", json={"review_date": "not-a-date"})
        assert response.status_code == 400
    finally:
        app.dependency_overrides.pop(verify_jwt, None)


def test_review_daily_requires_auth():
    app.dependency_overrides.pop(verify_jwt, None)
    response = TestClient(app).post("/agents/review/daily", json={})
    assert response.status_code in (401, 403)


class FakeWeeklyReviewGeminiClient:
    """Stands in for ai_core.client.GeminiClient in /agents/review/weekly - only
    chat.completions.create(..., response_format=json_schema) is called,
    reading response.content as a JSON string."""

    def __init__(self, recommendations: list[str]):
        self._recommendations = recommendations
        self.chat = self
        self.completions = self

    def create(self, **_kwargs):
        return type(
            "ChatCompletion", (), {"content": json.dumps({"recommendations": self._recommendations})}
        )


def test_review_weekly_generates_and_persists_a_review(conn, monkeypatch):
    monkeypatch.setattr(
        agents_module, "get_client", lambda: FakeWeeklyReviewGeminiClient(["Push harder"])
    )
    app.dependency_overrides[verify_jwt] = lambda: TEST_USER_ID
    project_id = _insert_project(conn, TEST_USER_ID)
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into tasks (user_id, project_id, title, status, completed_at)
            values (%s, %s, 'Ship it', 'done', now())
            """,
            (TEST_USER_ID, project_id),
        )
    conn.commit()

    try:
        response = TestClient(app).post("/agents/review/weekly", json={})
        assert response.status_code == 200
        body = response.json()
        assert len(body["project_progress"]) == 1
        assert body["recommendations"] == ["Push harder"]

        with conn.cursor() as cur:
            cur.execute("select count(*) from weekly_reviews where user_id = %s", (TEST_USER_ID,))
            assert cur.fetchone()[0] == 1
    finally:
        app.dependency_overrides.pop(verify_jwt, None)
        with conn.cursor() as cur:
            cur.execute("delete from weekly_reviews where user_id = %s", (TEST_USER_ID,))
        conn.commit()


def test_review_weekly_accepts_an_explicit_week_start(conn, monkeypatch):
    monkeypatch.setattr(agents_module, "get_client", lambda: FakeWeeklyReviewGeminiClient([]))
    app.dependency_overrides[verify_jwt] = lambda: TEST_USER_ID

    try:
        response = TestClient(app).post("/agents/review/weekly", json={"week_start": "2026-08-10"})
        assert response.status_code == 200
        assert response.json()["week_start"] == "2026-08-10"
    finally:
        app.dependency_overrides.pop(verify_jwt, None)
        with conn.cursor() as cur:
            cur.execute("delete from weekly_reviews where user_id = %s", (TEST_USER_ID,))
        conn.commit()


def test_review_weekly_rejects_invalid_week_start(conn, monkeypatch):
    monkeypatch.setattr(agents_module, "get_client", lambda: FakeWeeklyReviewGeminiClient([]))
    app.dependency_overrides[verify_jwt] = lambda: TEST_USER_ID

    try:
        response = TestClient(app).post("/agents/review/weekly", json={"week_start": "not-a-date"})
        assert response.status_code == 400
    finally:
        app.dependency_overrides.pop(verify_jwt, None)


def test_review_weekly_requires_auth():
    app.dependency_overrides.pop(verify_jwt, None)
    response = TestClient(app).post("/agents/review/weekly", json={})
    assert response.status_code in (401, 403)


class FakeMonthlyReviewGeminiClient:
    """Stands in for ai_core.client.GeminiClient in /agents/review/monthly - only
    chat.completions.create(..., response_format=json_schema) is called,
    reading response.content as a JSON string."""

    def __init__(self, recommendations: list[str]):
        self._recommendations = recommendations
        self.chat = self
        self.completions = self

    def create(self, **_kwargs):
        return type(
            "ChatCompletion", (), {"content": json.dumps({"recommendations": self._recommendations})}
        )


def test_review_monthly_rolls_up_weekly_reviews(conn, monkeypatch):
    monkeypatch.setattr(agents_module, "get_client", lambda: FakeMonthlyReviewGeminiClient(["Push harder"]))
    app.dependency_overrides[verify_jwt] = lambda: TEST_USER_ID
    with conn.cursor() as cur:
        cur.execute(
            "insert into weekly_reviews (user_id, week_start) values (%s, '2026-08-03')",
            (TEST_USER_ID,),
        )
    conn.commit()

    try:
        response = TestClient(app).post("/agents/review/monthly", json={"month_start": "2026-08-15"})
        assert response.status_code == 200
        body = response.json()
        assert body["month_start"] == "2026-08-01"  # normalized to the 1st
        assert body["weeks_included"] == 1
        assert body["recommendations"] == ["Push harder"]

        with conn.cursor() as cur:
            cur.execute("select count(*) from monthly_reviews where user_id = %s", (TEST_USER_ID,))
            assert cur.fetchone()[0] == 1
    finally:
        app.dependency_overrides.pop(verify_jwt, None)
        with conn.cursor() as cur:
            cur.execute("delete from monthly_reviews where user_id = %s", (TEST_USER_ID,))
            cur.execute("delete from weekly_reviews where user_id = %s", (TEST_USER_ID,))
        conn.commit()


def test_review_monthly_rejects_invalid_month_start(conn, monkeypatch):
    monkeypatch.setattr(agents_module, "get_client", lambda: FakeMonthlyReviewGeminiClient([]))
    app.dependency_overrides[verify_jwt] = lambda: TEST_USER_ID

    try:
        response = TestClient(app).post("/agents/review/monthly", json={"month_start": "not-a-date"})
        assert response.status_code == 400
    finally:
        app.dependency_overrides.pop(verify_jwt, None)


def test_review_monthly_requires_auth():
    app.dependency_overrides.pop(verify_jwt, None)
    response = TestClient(app).post("/agents/review/monthly", json={})
    assert response.status_code in (401, 403)


class FakeWriterGeminiClient:
    """Stands in for ai_core.client.GeminiClient in /agents/writer/draft - calls
    embeddings.create(...) (via ai_core.context.build_context) and
    chat.completions.create(...) (non-streaming, reading .content)."""

    def __init__(self, draft_content: str):
        self._draft_content = draft_content
        self.chat = self
        self.completions = self
        self.embeddings = self

    def create(self, **kwargs):
        if "messages" in kwargs:
            return type("ChatCompletion", (), {"content": self._draft_content})
        return type("EmbeddingResponse", (), {"embedding": [0.1] * 768})


def test_writer_draft_creates_a_note(conn, monkeypatch):
    monkeypatch.setattr(
        agents_module, "get_client", lambda: FakeWriterGeminiClient("# Investor update\n\nGood month.")
    )
    app.dependency_overrides[verify_jwt] = lambda: TEST_USER_ID

    try:
        response = TestClient(app).post(
            "/agents/writer/draft", json={"prompt": "Draft an investor update", "doc_type": "email"}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["title"] == "Investor update"
        assert body["action"] == "created"

        with conn.cursor() as cur:
            cur.execute("select count(*) from notes where id = %s", (body["note_id"],))
            assert cur.fetchone()[0] == 1
    finally:
        app.dependency_overrides.pop(verify_jwt, None)


def test_writer_draft_refines_an_existing_note(conn, monkeypatch):
    monkeypatch.setattr(
        agents_module, "get_client", lambda: FakeWriterGeminiClient("# Report\n\nRevised.")
    )
    app.dependency_overrides[verify_jwt] = lambda: TEST_USER_ID
    with conn.cursor() as cur:
        cur.execute(
            "insert into notes (user_id, title, content, note_type) values (%s, 'Report', 'Old.', 'summary') returning id",
            (TEST_USER_ID,),
        )
        note_id = str(cur.fetchone()[0])
    conn.commit()

    try:
        response = TestClient(app).post(
            "/agents/writer/draft",
            json={"prompt": "tighten it up", "existing_note_id": note_id},
        )
        assert response.status_code == 200
        assert response.json()["action"] == "updated"
        assert response.json()["note_id"] == note_id
    finally:
        app.dependency_overrides.pop(verify_jwt, None)


def test_writer_draft_rejects_note_owned_by_another_user(conn, monkeypatch):
    monkeypatch.setattr(agents_module, "get_client", lambda: FakeWriterGeminiClient("# X\n\nY."))
    app.dependency_overrides[verify_jwt] = lambda: TEST_USER_ID
    with conn.cursor() as cur:
        cur.execute(
            "insert into notes (user_id, title, content) values (%s, 'Not yours', 'x') returning id",
            (OTHER_USER_ID,),
        )
        other_note_id = str(cur.fetchone()[0])
    conn.commit()

    try:
        response = TestClient(app).post(
            "/agents/writer/draft",
            json={"prompt": "revise it", "existing_note_id": other_note_id},
        )
        assert response.status_code == 404
    finally:
        app.dependency_overrides.pop(verify_jwt, None)


def test_writer_draft_rejects_invalid_existing_note_id(conn, monkeypatch):
    monkeypatch.setattr(agents_module, "get_client", lambda: FakeWriterGeminiClient("# X\n\nY."))
    app.dependency_overrides[verify_jwt] = lambda: TEST_USER_ID

    try:
        response = TestClient(app).post(
            "/agents/writer/draft",
            json={"prompt": "revise it", "existing_note_id": "not-a-uuid"},
        )
        assert response.status_code == 400
    finally:
        app.dependency_overrides.pop(verify_jwt, None)


def test_writer_draft_requires_auth():
    app.dependency_overrides.pop(verify_jwt, None)
    response = TestClient(app).post("/agents/writer/draft", json={"prompt": "hi"})
    assert response.status_code in (401, 403)


class FakeWorkflowGeminiClient:
    """Stands in for ai_core.client.GeminiClient in /agents/workflow/check - only
    chat.completions.create(..., response_format=json_schema) is called,
    reading response.content as a JSON string."""

    def __init__(self, proposals: list[dict]):
        self._proposals = proposals
        self.chat = self
        self.completions = self

    def create(self, **_kwargs):
        return type("ChatCompletion", (), {"content": json.dumps({"proposals": self._proposals})})


def test_workflow_check_returns_proposals_for_flagged_projects(conn, monkeypatch):
    proposals = [{"project_name": "MyLMS", "issue": "A task is at risk.", "proposed_action": "Reschedule it."}]
    monkeypatch.setattr(agents_module, "get_client", lambda: FakeWorkflowGeminiClient(proposals))
    app.dependency_overrides[verify_jwt] = lambda: TEST_USER_ID
    project_id = _insert_project(conn, TEST_USER_ID, "MyLMS")
    with conn.cursor() as cur:
        cur.execute(
            "insert into tasks (user_id, project_id, title, status) values (%s, %s, 'Blocked', 'at_risk')",
            (TEST_USER_ID, project_id),
        )
    conn.commit()

    try:
        response = TestClient(app).post("/agents/workflow/check")
        assert response.status_code == 200
        body = response.json()
        assert body["projects_flagged"] == 1
        assert len(body["proposals"]) == 1
        assert body["proposals"][0]["project_name"] == "MyLMS"
    finally:
        app.dependency_overrides.pop(verify_jwt, None)
        with conn.cursor() as cur:
            cur.execute("delete from agent_actions where user_id = %s", (TEST_USER_ID,))
        conn.commit()


def test_workflow_check_returns_no_proposals_when_nothing_is_flagged(conn, monkeypatch):
    monkeypatch.setattr(agents_module, "get_client", lambda: FakeWorkflowGeminiClient([]))
    app.dependency_overrides[verify_jwt] = lambda: TEST_USER_ID
    _insert_project(conn, TEST_USER_ID, "Quiet project")

    try:
        response = TestClient(app).post("/agents/workflow/check")
        assert response.status_code == 200
        assert response.json()["proposals"] == []
    finally:
        app.dependency_overrides.pop(verify_jwt, None)


def test_workflow_check_requires_auth():
    app.dependency_overrides.pop(verify_jwt, None)
    response = TestClient(app).post("/agents/workflow/check")
    assert response.status_code in (401, 403)


class FakeResearchGeminiClient:
    """Stands in for ai_core.client.GeminiClient in /agents/research/synthesize -
    only chat.completions.create(...) (non-streaming, reading .content) is
    called."""

    def __init__(self, content: str):
        self._content = content
        self.chat = self
        self.completions = self

    def create(self, **_kwargs):
        return type("ChatCompletion", (), {"content": self._content})


def test_research_synthesize_creates_a_note(conn, monkeypatch):
    monkeypatch.setattr(
        agents_module, "get_client", lambda: FakeResearchGeminiClient("# Findings\n\nSummary.")
    )
    monkeypatch.setattr(
        "ai_core.agents.research.fetch_url_text", lambda url: "Fetched page text."
    )
    app.dependency_overrides[verify_jwt] = lambda: TEST_USER_ID

    try:
        response = TestClient(app).post(
            "/agents/research/synthesize",
            json={"topic": "caching strategies", "urls": ["https://example.com/a"]},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["title"] == "Findings"
        assert body["sources"][0]["fetched"] is True

        with conn.cursor() as cur:
            cur.execute("select count(*) from notes where id = %s", (body["note_id"],))
            assert cur.fetchone()[0] == 1
    finally:
        app.dependency_overrides.pop(verify_jwt, None)


def test_research_synthesize_requires_at_least_one_url(conn, monkeypatch):
    monkeypatch.setattr(agents_module, "get_client", lambda: FakeResearchGeminiClient("# X\n\nY."))
    app.dependency_overrides[verify_jwt] = lambda: TEST_USER_ID

    try:
        response = TestClient(app).post(
            "/agents/research/synthesize", json={"topic": "x", "urls": []}
        )
        assert response.status_code == 400
    finally:
        app.dependency_overrides.pop(verify_jwt, None)


def test_research_synthesize_returns_422_when_every_source_fails(conn, monkeypatch):
    monkeypatch.setattr(agents_module, "get_client", lambda: FakeResearchGeminiClient("unused"))

    def raise_fetch_error(url):
        from ai_core.webfetch import FetchError

        raise FetchError("nope")

    monkeypatch.setattr("ai_core.agents.research.fetch_url_text", raise_fetch_error)
    app.dependency_overrides[verify_jwt] = lambda: TEST_USER_ID

    try:
        response = TestClient(app).post(
            "/agents/research/synthesize",
            json={"topic": "x", "urls": ["https://example.com/unreachable"]},
        )
        assert response.status_code == 422
    finally:
        app.dependency_overrides.pop(verify_jwt, None)


def test_research_synthesize_requires_auth():
    app.dependency_overrides.pop(verify_jwt, None)
    response = TestClient(app).post(
        "/agents/research/synthesize", json={"topic": "x", "urls": ["https://example.com"]}
    )
    assert response.status_code in (401, 403)
