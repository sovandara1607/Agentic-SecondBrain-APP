import json
import os
import uuid
from datetime import date, datetime, timedelta

import psycopg
import pytest

from ai_core.agents.workflow import run_workflow_check

DATABASE_URL = os.environ["DATABASE_URL"]
TEST_USER_ID = "15151515-1515-1515-1515-151515151515"
TODAY = date.today()


class FakeGeminiClient:
    """Stands in for ai_core.client.GeminiClient - run_workflow_check only
    calls client.chat.completions.create(...) with response_format=json_schema,
    reading response.content as a JSON string."""

    def __init__(self, proposals: list[dict]):
        self._proposals = proposals
        self.chat = self
        self.completions = self
        self.calls = 0

    def create(self, **_kwargs):
        self.calls += 1
        return type("ChatCompletion", (), {"content": json.dumps({"proposals": self._proposals})})


@pytest.fixture
def conn():
    with psycopg.connect(DATABASE_URL, autocommit=False) as connection:
        with connection.cursor() as cur:
            cur.execute(
                """
                insert into auth.users (id, email, encrypted_password)
                values (%s, 'phase4-workflow-test@example.com', 'x')
                on conflict (id) do nothing
                """,
                (TEST_USER_ID,),
            )
        connection.commit()
        yield connection
        with connection.cursor() as cur:
            cur.execute("delete from auth.users where id = %s", (TEST_USER_ID,))
        connection.commit()


def _insert_project(conn, name="MyLMS", **fields) -> uuid.UUID:
    columns = ["user_id", "name", *fields.keys()]
    placeholders = ["%s"] * len(columns)
    with conn.cursor() as cur:
        cur.execute(
            f"insert into projects ({', '.join(columns)}) values ({', '.join(placeholders)}) returning id",
            (TEST_USER_ID, name, *fields.values()),
        )
        project_id = cur.fetchone()[0]
    conn.commit()
    return project_id


def _insert_task(conn, project_id, title="Task", **fields) -> uuid.UUID:
    columns = ["user_id", "project_id", "title", *fields.keys()]
    placeholders = ["%s"] * len(columns)
    with conn.cursor() as cur:
        cur.execute(
            f"insert into tasks ({', '.join(columns)}) values ({', '.join(placeholders)}) returning id",
            (TEST_USER_ID, project_id, title, *fields.values()),
        )
        task_id = cur.fetchone()[0]
    conn.commit()
    return task_id


def test_run_workflow_check_skips_the_llm_when_nothing_is_flagged(conn):
    _insert_project(conn, "Quiet project")
    client = FakeGeminiClient([])

    result = run_workflow_check(conn, client, TEST_USER_ID)

    assert client.calls == 0
    assert result.proposals == []
    assert result.projects_checked == 1
    assert result.projects_flagged == 0


def test_run_workflow_check_flags_at_risk_tasks(conn):
    project_id = _insert_project(conn, "MyLMS")
    _insert_task(conn, project_id, "Blocked task", status="at_risk")
    client = FakeGeminiClient(
        [{"project_name": "MyLMS", "issue": "A task is at risk.", "proposed_action": "Reschedule it."}]
    )

    result = run_workflow_check(conn, client, TEST_USER_ID)

    assert client.calls == 1
    assert len(result.proposals) == 1
    assert result.proposals[0].project_name == "MyLMS"
    assert result.proposals[0].issue == "A task is at risk."


def test_run_workflow_check_flags_overdue_tasks(conn):
    project_id = _insert_project(conn, "MyLMS")
    _insert_task(
        conn, project_id, "Overdue task", status="open",
        deadline=datetime.now() - timedelta(days=3),
    )
    client = FakeGeminiClient(
        [{"project_name": "MyLMS", "issue": "Overdue task.", "proposed_action": "Do it."}]
    )

    result = run_workflow_check(conn, client, TEST_USER_ID)

    assert len(result.proposals) == 1


def test_run_workflow_check_flags_approaching_deadline_with_low_progress(conn):
    project_id = _insert_project(conn, "MyLMS", target_date=TODAY + timedelta(days=5))
    _insert_task(conn, project_id, "Not done", status="open")
    _insert_task(conn, project_id, "Also not done", status="open")
    client = FakeGeminiClient(
        [{"project_name": "MyLMS", "issue": "Behind schedule.", "proposed_action": "Cut scope."}]
    )

    result = run_workflow_check(conn, client, TEST_USER_ID)

    assert len(result.proposals) == 1


def test_run_workflow_check_ignores_proposals_for_unlisted_projects(conn):
    project_id = _insert_project(conn, "MyLMS")
    _insert_task(conn, project_id, "Blocked", status="at_risk")
    client = FakeGeminiClient(
        [{"project_name": "Not a real project", "issue": "x", "proposed_action": "y"}]
    )

    result = run_workflow_check(conn, client, TEST_USER_ID)

    assert result.proposals == []


def test_run_workflow_check_persists_a_proposed_agent_action(conn):
    project_id = _insert_project(conn, "MyLMS")
    _insert_task(conn, project_id, "Blocked", status="at_risk")
    client = FakeGeminiClient(
        [{"project_name": "MyLMS", "issue": "A task is at risk.", "proposed_action": "Reschedule it."}]
    )

    result = run_workflow_check(conn, client, TEST_USER_ID)

    with conn.cursor() as cur:
        cur.execute(
            "select agent_name, action_kind, status, target_type, target_id, summary from agent_actions where id = %s",
            (result.proposals[0].id,),
        )
        row = cur.fetchone()
    assert row == ("workflow", "suggested", "proposed", "project", project_id, "A task is at risk.")


def test_run_workflow_check_skips_projects_with_a_recent_unresolved_proposal(conn):
    project_id = _insert_project(conn, "MyLMS")
    _insert_task(conn, project_id, "Blocked", status="at_risk")
    client = FakeGeminiClient(
        [{"project_name": "MyLMS", "issue": "A task is at risk.", "proposed_action": "Reschedule it."}]
    )

    first = run_workflow_check(conn, client, TEST_USER_ID)
    assert len(first.proposals) == 1

    second = run_workflow_check(conn, client, TEST_USER_ID)
    assert second.proposals == []

    with conn.cursor() as cur:
        cur.execute(
            "select count(*) from agent_actions where user_id = %s and agent_name = 'workflow'",
            (TEST_USER_ID,),
        )
        assert cur.fetchone()[0] == 1
