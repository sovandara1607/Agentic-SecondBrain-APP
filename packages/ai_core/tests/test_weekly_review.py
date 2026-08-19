import json
import os
import uuid
from datetime import date, datetime

import psycopg
import pytest

from ai_core.agents.review import generate_weekly_review

DATABASE_URL = os.environ["DATABASE_URL"]
TEST_USER_ID = "88888888-8888-8888-8888-888888888888"
WEEK_START = date(2026, 8, 10)  # Monday


class FakeGeminiClient:
    """Stands in for ai_core.client.GeminiClient - generate_weekly_review only
    calls client.chat.completions.create(...) with response_format=json_schema,
    reading response.content as a JSON string."""

    def __init__(self, recommendations: list[str]):
        self._recommendations = recommendations
        self.chat = self
        self.completions = self
        self.calls = 0

    def create(self, **_kwargs):
        self.calls += 1
        return type(
            "ChatCompletion", (), {"content": json.dumps({"recommendations": self._recommendations})}
        )


@pytest.fixture
def conn():
    with psycopg.connect(DATABASE_URL, autocommit=False) as connection:
        with connection.cursor() as cur:
            cur.execute(
                """
                insert into auth.users (id, email, encrypted_password)
                values (%s, 'phase4-weekly-review-test@example.com', 'x')
                on conflict (id) do nothing
                """,
                (TEST_USER_ID,),
            )
        connection.commit()
        yield connection
        with connection.cursor() as cur:
            cur.execute("delete from auth.users where id = %s", (TEST_USER_ID,))
        connection.commit()


def _insert_project(conn, user_id: str, name: str = "MyLMS") -> uuid.UUID:
    with conn.cursor() as cur:
        cur.execute(
            "insert into projects (user_id, name) values (%s, %s) returning id", (user_id, name)
        )
        project_id = cur.fetchone()[0]
    conn.commit()
    return project_id


def _insert_task(conn, user_id, project_id, title, **fields) -> uuid.UUID:
    columns = ["user_id", "project_id", "title", *fields.keys()]
    placeholders = ["%s"] * len(columns)
    with conn.cursor() as cur:
        cur.execute(
            f"insert into tasks ({', '.join(columns)}) values ({', '.join(placeholders)}) returning id",
            (user_id, project_id, title, *fields.values()),
        )
        task_id = cur.fetchone()[0]
    conn.commit()
    return task_id


def test_generate_weekly_review_computes_project_progress_from_tasks(conn):
    project_id = _insert_project(conn, TEST_USER_ID)
    _insert_task(
        conn, TEST_USER_ID, project_id, "Done in week",
        status="done", completed_at=datetime(2026, 8, 12, 10, 0),
    )
    _insert_task(conn, TEST_USER_ID, project_id, "Still open", status="open")

    result = generate_weekly_review(conn, FakeGeminiClient([]), TEST_USER_ID, WEEK_START)

    assert len(result.project_progress) == 1
    progress = result.project_progress[0]
    assert progress["progress"] == 50
    assert progress["completed_this_week"] == 1


def test_generate_weekly_review_excludes_projects_with_no_tasks(conn):
    _insert_project(conn, TEST_USER_ID, "Empty project")

    result = generate_weekly_review(conn, FakeGeminiClient([]), TEST_USER_ID, WEEK_START)

    assert result.project_progress == []


def test_generate_weekly_review_gathers_knowledge_learned(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into notes (user_id, title, content, note_type, created_at)
            values (%s, 'Redis vs Postgres', 'notes...', 'note', %s)
            """,
            (TEST_USER_ID, datetime(2026, 8, 12, 9, 0)),
        )
        cur.execute(
            """
            insert into notes (user_id, title, content, note_type, created_at)
            values (%s, 'Outside the window', 'notes...', 'note', %s)
            """,
            (TEST_USER_ID, datetime(2026, 8, 20, 9, 0)),
        )
    conn.commit()

    result = generate_weekly_review(conn, FakeGeminiClient([]), TEST_USER_ID, WEEK_START)

    assert [n["title"] for n in result.knowledge_learned] == ["Redis vs Postgres"]


def test_generate_weekly_review_computes_time_allocation_for_done_tasks_only(conn):
    project_id = _insert_project(conn, TEST_USER_ID, "MyLMS")
    done_id = _insert_task(conn, TEST_USER_ID, project_id, "Ship it", status="done")
    open_id = _insert_task(conn, TEST_USER_ID, project_id, "Not yet", status="open")
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into time_blocks (user_id, task_id, starts_at, ends_at, status)
            values (%s, %s, %s, %s, 'scheduled')
            """,
            (TEST_USER_ID, done_id, datetime(2026, 8, 12, 9, 0), datetime(2026, 8, 12, 10, 30)),
        )
        cur.execute(
            """
            insert into time_blocks (user_id, task_id, starts_at, ends_at, status)
            values (%s, %s, %s, %s, 'scheduled')
            """,
            (TEST_USER_ID, open_id, datetime(2026, 8, 13, 9, 0), datetime(2026, 8, 13, 11, 0)),
        )
    conn.commit()

    result = generate_weekly_review(conn, FakeGeminiClient([]), TEST_USER_ID, WEEK_START)

    assert result.time_allocation == {"MyLMS": 90}


def test_generate_weekly_review_gathers_missed_deadlines(conn):
    project_id = _insert_project(conn, TEST_USER_ID)
    _insert_task(
        conn, TEST_USER_ID, project_id, "Overdue", status="open",
        deadline=datetime(2026, 8, 13, 18, 0),
    )
    _insert_task(
        conn, TEST_USER_ID, project_id, "Finished before deadline", status="done",
        deadline=datetime(2026, 8, 14, 18, 0), completed_at=datetime(2026, 8, 13, 12, 0),
    )

    result = generate_weekly_review(conn, FakeGeminiClient([]), TEST_USER_ID, WEEK_START)

    assert [d["title"] for d in result.missed_deadlines] == ["Overdue"]


def test_generate_weekly_review_skips_llm_call_on_a_quiet_week(conn):
    client = FakeGeminiClient(["should not be used"])

    result = generate_weekly_review(conn, client, TEST_USER_ID, WEEK_START)

    assert client.calls == 0
    assert result.recommendations == []


def test_generate_weekly_review_persists_and_logs_agent_action(conn):
    project_id = _insert_project(conn, TEST_USER_ID)
    _insert_task(
        conn, TEST_USER_ID, project_id, "Ship it",
        status="done", completed_at=datetime(2026, 8, 12, 10, 0),
    )

    result = generate_weekly_review(
        conn, FakeGeminiClient(["Push harder on MyLMS"]), TEST_USER_ID, WEEK_START
    )

    with conn.cursor() as cur:
        cur.execute(
            "select week_start, recommendations from weekly_reviews where id = %s",
            (result.id,),
        )
        row = cur.fetchone()
        assert row[0] == WEEK_START
        assert row[1] == ["Push harder on MyLMS"]

        cur.execute(
            "select agent_name, action_kind, target_type, target_id from agent_actions where user_id = %s",
            (TEST_USER_ID,),
        )
        action = cur.fetchone()
    assert action == ("review", "created", "weekly_review", result.id)


def test_generate_weekly_review_upserts_on_retrigger(conn):
    project_id = _insert_project(conn, TEST_USER_ID)
    _insert_task(
        conn, TEST_USER_ID, project_id, "Ship it",
        status="done", completed_at=datetime(2026, 8, 12, 10, 0),
    )
    first = generate_weekly_review(conn, FakeGeminiClient(["First pass"]), TEST_USER_ID, WEEK_START)

    _insert_task(
        conn, TEST_USER_ID, project_id, "Ship it too",
        status="done", completed_at=datetime(2026, 8, 13, 10, 0),
    )
    second = generate_weekly_review(conn, FakeGeminiClient(["Second pass"]), TEST_USER_ID, WEEK_START)

    assert second.id == first.id
    with conn.cursor() as cur:
        cur.execute("select count(*) from weekly_reviews where user_id = %s", (TEST_USER_ID,))
        assert cur.fetchone()[0] == 1
