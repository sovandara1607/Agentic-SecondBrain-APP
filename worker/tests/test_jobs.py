import json
import os
import uuid

import psycopg
import pytest

from main import (
    claim_next_job,
    handle_job,
    mark_job_status,
    run_daily_digest_pass,
    run_workflow_check_pass,
)

DATABASE_URL = os.environ["DATABASE_URL"]
TEST_USER_ID = "22222222-2222-2222-2222-222222222222"


class FakeGeminiClient:
    """Stands in for ai_core.client.GeminiClient - see the identical fixture
    in packages/ai_core/tests/test_workflow.py for the shape run_workflow_check
    expects from client.chat.completions.create(...)."""

    def __init__(self, proposals: list[dict]):
        self._proposals = proposals
        self.chat = self
        self.completions = self

    def create(self, **_kwargs):
        return type("ChatCompletion", (), {"content": json.dumps({"proposals": self._proposals})})


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
            cur.execute("delete from jobs where user_id = %s", (TEST_USER_ID,))
        connection.commit()
        yield connection
        with connection.cursor() as cur:
            cur.execute("delete from jobs where user_id = %s", (TEST_USER_ID,))
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


def test_mark_job_status_updates_status(conn):
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

    mark_job_status(conn, job_id, "done")

    with conn.cursor() as cur:
        cur.execute("select status from jobs where id = %s", (job_id,))
        (status,) = cur.fetchone()
    assert status == "done"


def test_handle_job_with_unknown_job_type_does_not_raise(conn):
    # job_type without a registered handler (everything except
    # process_capture, for now) is a no-op, not a failure - see
    # handle_job's docstring comment in worker/main.py.
    handle_job(conn, {"id": uuid.uuid4(), "job_type": "smoke_test", "payload": {}})


def test_run_workflow_check_pass_flags_stalled_project_for_active_user(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into projects (user_id, name, status, updated_at)
            values (%s, 'Stalled Project', 'active', now() - interval '10 days')
            returning id
            """,
            (TEST_USER_ID,),
        )
        project_id = cur.fetchone()[0]
        cur.execute(
            """
            insert into tasks (user_id, project_id, title, status, updated_at, created_at)
            values (%s, %s, 'Old task', 'open', now() - interval '10 days', now() - interval '10 days')
            """,
            (TEST_USER_ID, project_id),
        )
    conn.commit()

    client = FakeGeminiClient(
        [{"project_name": "Stalled Project", "issue": "Gone quiet", "proposed_action": "Ping it"}]
    )

    run_workflow_check_pass(conn, client)

    with conn.cursor() as cur:
        cur.execute(
            "select summary from agent_actions where user_id = %s and agent_name = 'workflow'",
            (TEST_USER_ID,),
        )
        rows = cur.fetchall()
    assert rows == [("Gone quiet",)]

    with conn.cursor() as cur:
        cur.execute("delete from agent_actions where user_id = %s", (TEST_USER_ID,))
        cur.execute("delete from tasks where user_id = %s", (TEST_USER_ID,))
        cur.execute("delete from projects where user_id = %s", (TEST_USER_ID,))
    conn.commit()


def test_run_workflow_check_pass_writes_nothing_for_a_healthy_project(conn):
    # A recently-active project with no at-risk/overdue tasks and no
    # target_date trips none of run_workflow_check's signals, so it's
    # never even sent to the model - no proposal should land for it.
    # This dev DB may hold other users' real active projects too (this
    # is a shared local stack, not an isolated test DB), so the test
    # can't assume run_workflow_check_pass finds zero users to check;
    # it only asserts on TEST_USER_ID's own agent_actions rows.
    with conn.cursor() as cur:
        cur.execute(
            "insert into projects (user_id, name, status) values (%s, 'Healthy Project', 'active')",
            (TEST_USER_ID,),
        )
    conn.commit()

    client = FakeGeminiClient([])
    run_workflow_check_pass(conn, client)

    with conn.cursor() as cur:
        cur.execute(
            "select count(*) from agent_actions where user_id = %s and agent_name = 'workflow'",
            (TEST_USER_ID,),
        )
        (count,) = cur.fetchone()
    assert count == 0

    with conn.cursor() as cur:
        cur.execute("delete from projects where user_id = %s", (TEST_USER_ID,))
    conn.commit()


def test_run_daily_digest_pass_noops_when_smtp_not_configured(conn, monkeypatch):
    # The real ai_core.email.smtp_configured() - not mocked here on
    # purpose - reflects this test env's actual SMTP_* vars (unset).
    # The pass should return immediately without touching the DB or
    # raising, same as a real deploy with no mail configured.
    import main

    called = False

    def fail_if_called(*_a, **_k):
        nonlocal called
        called = True

    monkeypatch.setattr(main, "send_digest", fail_if_called)
    run_daily_digest_pass(conn)
    assert called is False


def test_run_daily_digest_pass_sends_for_overdue_task(conn, monkeypatch):
    import main

    sent = []
    monkeypatch.setattr(main, "smtp_configured", lambda: True)
    monkeypatch.setattr(main, "send_digest", lambda to, content, app_url: sent.append((to, content)))

    with conn.cursor() as cur:
        cur.execute(
            """
            insert into tasks (user_id, title, status, deadline)
            values (%s, 'Overdue digest test', 'open', now() - interval '1 day')
            """,
            (TEST_USER_ID,),
        )
    conn.commit()

    run_daily_digest_pass(conn)

    mine = [(to, c) for to, c in sent if to == "phase0-worker-test@example.com"]
    assert len(mine) == 1
    assert "Overdue digest test" in mine[0][1].overdue_task_titles

    with conn.cursor() as cur:
        cur.execute("delete from tasks where user_id = %s", (TEST_USER_ID,))
    conn.commit()


def test_run_daily_digest_pass_skips_user_with_nothing_to_report(conn, monkeypatch):
    import main

    sent = []
    monkeypatch.setattr(main, "smtp_configured", lambda: True)
    monkeypatch.setattr(main, "send_digest", lambda to, content, app_url: sent.append(to))

    # No overdue tasks, no proposals, no review for TEST_USER_ID - an
    # empty digest must never be sent (see run_daily_digest_pass's
    # has_content check).
    run_daily_digest_pass(conn)

    assert "phase0-worker-test@example.com" not in sent
