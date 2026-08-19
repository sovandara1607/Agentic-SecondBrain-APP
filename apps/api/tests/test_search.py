import os

import psycopg
import pytest
from fastapi.testclient import TestClient

import routers.search as search_module
from core.auth import verify_jwt
from main import app

DATABASE_URL = os.environ["DATABASE_URL"]
TEST_USER_ID = "14141414-1414-1414-1414-141414141414"


class FakeGeminiClient:
    """Stands in for ai_core.client.GeminiClient in GET /search - only
    embeddings.create(...) (via ai_core.context.embed_query) is called."""

    def __init__(self):
        self.embeddings = self

    def create(self, **_kwargs):
        return type("EmbeddingResponse", (), {"embedding": [0.1] * 768})


@pytest.fixture
def conn():
    with psycopg.connect(DATABASE_URL, autocommit=False) as connection:
        with connection.cursor() as cur:
            cur.execute(
                """
                insert into auth.users (id, email, encrypted_password)
                values (%s, 'phase4-search-endpoint-test@example.com', 'x')
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
    monkeypatch.setattr(search_module, "get_client", lambda: FakeGeminiClient())
    app.dependency_overrides[verify_jwt] = lambda: TEST_USER_ID
    yield TestClient(app)
    app.dependency_overrides.pop(verify_jwt, None)


def test_search_finds_a_matching_note(client, conn):
    with conn.cursor() as cur:
        cur.execute(
            "insert into notes (user_id, title, content) values (%s, %s, %s) returning id",
            (TEST_USER_ID, "Redis vs Postgres caching", "Comparing options."),
        )
        note_id = str(cur.fetchone()[0])
    conn.commit()

    response = client.get("/search", params={"q": "Redis vs Postgres caching"})

    assert response.status_code == 200
    body = response.json()
    assert body["query"] == "Redis vs Postgres caching"
    matched = [r for r in body["results"] if r["content_id"] == note_id]
    assert len(matched) == 1
    assert matched[0]["content_type"] == "note"


def test_search_rejects_unsupported_mode(client):
    response = client.get("/search", params={"q": "anything", "mode": "vector"})
    assert response.status_code == 400


def test_search_requires_a_query(client):
    response = client.get("/search")
    assert response.status_code == 422


def test_search_requires_auth():
    app.dependency_overrides.pop(verify_jwt, None)
    response = TestClient(app).get("/search", params={"q": "anything"})
    assert response.status_code in (401, 403)
