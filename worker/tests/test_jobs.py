import os
import uuid

import psycopg
import pytest

from main import claim_next_job, mark_done

DATABASE_URL = os.environ["DATABASE_URL"]
TEST_USER_ID = "22222222-2222-2222-2222-222222222222"


@pytest.fixture
def conn():
    with psycopg.connect(DATABASE_URL, autocommit=False) as connection:
        with connection.cursor() as cur:
            cur.execute(
                """
                insert into auth.users (id, email, encrypted_password)
                values (%s, 'phase0-worker-test@example.com', 'x')
                on conflict (id) do nothing
                """,
                (TEST_USER_ID,),
            )
        connection.commit()
        yield connection
        with connection.cursor() as cur:
            cur.execute("delete from auth.users where id = %s", (TEST_USER_ID,))
        connection.commit()


def test_claim_next_job_returns_queued_job_and_marks_it_running(conn):
    job_id = uuid.uuid4()
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into jobs (id, user_id, job_type, payload, status)
            values (%s, %s, 'smoke_test', '{}', 'queued')
            """,
            (job_id, TEST_USER_ID),
        )
    conn.commit()

    job = claim_next_job(conn)

    assert job is not None
    assert job["id"] == job_id
    assert job["job_type"] == "smoke_test"

    with conn.cursor() as cur:
        cur.execute("select status, attempts from jobs where id = %s", (job_id,))
        status, attempts = cur.fetchone()
    assert status == "running"
    assert attempts == 1


def test_claim_next_job_returns_none_when_queue_is_empty(conn):
    with conn.cursor() as cur:
        cur.execute("delete from jobs where user_id = %s", (TEST_USER_ID,))
    conn.commit()

    job = claim_next_job(conn)

    assert job is None


def test_mark_done_sets_status_done(conn):
    job_id = uuid.uuid4()
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into jobs (id, user_id, job_type, payload, status)
            values (%s, %s, 'smoke_test', '{}', 'running')
            """,
            (job_id, TEST_USER_ID),
        )
    conn.commit()

    mark_done(conn, job_id)

    with conn.cursor() as cur:
        cur.execute("select status from jobs where id = %s", (job_id,))
        (status,) = cur.fetchone()
    assert status == "done"
