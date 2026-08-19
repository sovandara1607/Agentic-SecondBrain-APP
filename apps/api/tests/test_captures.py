import os

import psycopg
import pytest
from fastapi.testclient import TestClient

from core.auth import verify_jwt, verify_jwt_or_api_token
from main import app

DATABASE_URL = os.environ["DATABASE_URL"]
TEST_USER_ID = "16161616-1616-1616-1616-161616161616"
OTHER_USER_ID = "17171717-1717-1717-1717-171717171717"


@pytest.fixture
def conn():
    with psycopg.connect(DATABASE_URL, autocommit=False) as connection:
        with connection.cursor() as cur:
            cur.execute(
                """
                insert into auth.users (id, email, encrypted_password)
                values (%s, 'phase-captures-reprocess-test@example.com', 'x')
                on conflict (id) do nothing
                """,
                (TEST_USER_ID,),
            )
            cur.execute(
                """
                insert into auth.users (id, email, encrypted_password)
                values (%s, 'phase-captures-reprocess-other-test@example.com', 'x')
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


def _insert_capture(conn, user_id: str, status: str = "failed", pipeline_error: str | None = "boom") -> str:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into captures (user_id, kind, raw_text, status, pipeline_error, processed_at)
            values (%s, 'text', 'some text', %s, %s, now())
            returning id
            """,
            (user_id, status, pipeline_error),
        )
        capture_id = str(cur.fetchone()[0])
    conn.commit()
    return capture_id


@pytest.fixture
def client(conn):
    app.dependency_overrides[verify_jwt] = lambda: TEST_USER_ID
    app.dependency_overrides[verify_jwt_or_api_token] = lambda: TEST_USER_ID
    yield TestClient(app)
    app.dependency_overrides.pop(verify_jwt, None)
    app.dependency_overrides.pop(verify_jwt_or_api_token, None)


def test_reprocess_capture_resets_status_and_enqueues_a_job(client, conn):
    capture_id = _insert_capture(conn, TEST_USER_ID)

    response = client.post(f"/captures/{capture_id}/reprocess")

    assert response.status_code == 200
    assert response.json() == {"capture_id": capture_id, "status": "pending"}

    with conn.cursor() as cur:
        cur.execute(
            "select status, pipeline_error, processed_at from captures where id = %s", (capture_id,)
        )
        status, pipeline_error, processed_at = cur.fetchone()
        assert status == "pending"
        assert pipeline_error is None
        assert processed_at is None

        cur.execute(
            "select job_type, payload from jobs where user_id = %s order by created_at desc limit 1",
            (TEST_USER_ID,),
        )
        job_type, payload = cur.fetchone()
        assert job_type == "process_capture"
        assert payload["capture_id"] == capture_id


def test_reprocess_capture_rejects_capture_owned_by_another_user(client, conn):
    other_capture_id = _insert_capture(conn, OTHER_USER_ID)

    response = client.post(f"/captures/{other_capture_id}/reprocess")

    assert response.status_code == 404
    with conn.cursor() as cur:
        cur.execute("select status from captures where id = %s", (other_capture_id,))
        assert cur.fetchone()[0] == "failed"  # untouched


def test_reprocess_capture_rejects_missing_capture(client):
    response = client.post("/captures/00000000-0000-0000-0000-000000000000/reprocess")
    assert response.status_code == 404


def test_reprocess_capture_rejects_invalid_capture_id(client):
    response = client.post("/captures/not-a-uuid/reprocess")
    assert response.status_code == 400


def test_reprocess_capture_requires_auth():
    app.dependency_overrides.pop(verify_jwt, None)
    response = TestClient(app).post("/captures/00000000-0000-0000-0000-000000000000/reprocess")
    assert response.status_code in (401, 403)


def test_create_capture_via_session(client, conn):
    response = client.post("/captures", json={"raw_text": "jot this down"})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "pending"

    with conn.cursor() as cur:
        cur.execute("select kind, raw_text from captures where id = %s", (body["id"],))
        kind, raw_text = cur.fetchone()
    assert kind == "text"
    assert raw_text == "jot this down"


def test_create_capture_infers_url_kind(client, conn):
    response = client.post("/captures", json={"source_url": "https://example.com/article"})

    assert response.status_code == 200
    with conn.cursor() as cur:
        cur.execute("select kind from captures where id = %s", (response.json()["id"],))
        assert cur.fetchone()[0] == "url"


def test_create_capture_rejects_empty_body(client):
    response = client.post("/captures", json={})
    assert response.status_code == 400


def test_create_capture_requires_auth():
    app.dependency_overrides.pop(verify_jwt_or_api_token, None)
    response = TestClient(app).post("/captures", json={"raw_text": "hi"})
    assert response.status_code in (401, 403)


def test_create_capture_via_a_real_api_token_end_to_end(conn):
    # No dependency_overrides here - this exercises the actual API-token
    # verification path (core/auth.py's verify_jwt_or_api_token), not a
    # stubbed-out user_id, since that's the whole feature being tested.
    from core import auth as auth_module

    token = auth_module.API_TOKEN_PREFIX + "an-end-to-end-test-token"
    with conn.cursor() as cur:
        cur.execute(
            "insert into api_tokens (user_id, name, token_hash, token_prefix) values (%s, 'test', %s, %s)",
            (TEST_USER_ID, auth_module._hash_api_token(token), token[:12]),
        )
    conn.commit()

    try:
        response = TestClient(app).post(
            "/captures",
            json={"raw_text": "captured via script"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200

        with conn.cursor() as cur:
            cur.execute(
                "select user_id from captures where id = %s", (response.json()["id"],)
            )
            assert str(cur.fetchone()[0]) == TEST_USER_ID
    finally:
        with conn.cursor() as cur:
            cur.execute("delete from api_tokens where user_id = %s", (TEST_USER_ID,))
        conn.commit()
