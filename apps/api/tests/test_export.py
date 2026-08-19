import os
import zipfile
from io import BytesIO

import psycopg
import pytest
from fastapi.testclient import TestClient

from core.auth import verify_jwt
from main import app

DATABASE_URL = os.environ["DATABASE_URL"]
TEST_USER_ID = "22222222-3333-3333-3333-333333333333"


@pytest.fixture
def conn():
    with psycopg.connect(DATABASE_URL, autocommit=False) as connection:
        with connection.cursor() as cur:
            cur.execute(
                """
                insert into auth.users (id, email, encrypted_password)
                values (%s, 'phase-export-endpoint-test@example.com', 'x')
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
def client(conn):
    app.dependency_overrides[verify_jwt] = lambda: TEST_USER_ID
    yield TestClient(app)
    app.dependency_overrides.pop(verify_jwt, None)


def test_export_returns_a_downloadable_zip(client, conn):
    with conn.cursor() as cur:
        cur.execute(
            "insert into notes (user_id, title, content) values (%s, 'A note', 'body')",
            (TEST_USER_ID,),
        )
    conn.commit()

    response = client.get("/export")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert "attachment" in response.headers["content-disposition"]
    assert ".zip" in response.headers["content-disposition"]

    with zipfile.ZipFile(BytesIO(response.content)) as zf:
        assert "Notes/A note.md" in zf.namelist()


def test_export_requires_auth():
    app.dependency_overrides.pop(verify_jwt, None)
    response = TestClient(app).get("/export")
    assert response.status_code in (401, 403)
