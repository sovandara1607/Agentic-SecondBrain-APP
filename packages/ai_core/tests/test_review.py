import json
import os
import uuid
from datetime import date, datetime

import psycopg
import pytest

from ai_core.agents.review import generate_daily_review

DATABASE_URL = os.environ["DATABASE_URL"]
TEST_USER_ID = "77777777-7777-7777-7777-777777777777"
REVIEW_DATE = date(2026, 8, 17)


class FakeGeminiClient:
    """Stands in for ai_core.client.GeminiClient - generate_daily_review only
    calls client.chat.completions.create(...) with response_format=json_schema,
    reading response.content as a JSON string."""

    def __init__(self, priorities: list[str]):
        self._priorities = priorities
        self.chat = self
        self.completions = self
        self.calls = 0

    def create(self, **_kwargs):
        self.calls += 1
        return type("ChatCompletion", (), {"content": json.dumps({"priorities": self._priorities})})


@pytest.fixture
def conn():
    with psycopg.connect(DATABASE_URL, autocommit=False) as connection:
        with connection.cursor() as cur:
            cur.execute(
                """
                insert into auth.users (id, email, encrypted_password)
                values (%s, 'phase4-review-test@example.com', 'x')
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


def test_generate_daily_review_gathers_completed_and_unfinished_tasks(conn):
    project_id = _insert_project(conn, TEST_USER_ID)
    _insert_task(
        conn,
        TEST_USER_ID,
        project_id,
        "Ship the release",
        status="done",
        completed_at=datetime(2026, 8, 17, 14, 0),
    )
    _insert_task(
        conn,
        TEST_USER_ID,
        project_id,
        "Overdue write-up",
        status="open",
        deadline=datetime(2026, 8, 17, 18, 0),
    )

    result = generate_daily_review(conn, FakeGeminiClient(["Finish the write-up"]), TEST_USER_ID, REVIEW_DATE)

    assert [t["title"] for t in result.completed_tasks] == ["Ship the release"]
    assert [t["title"] for t in result.unfinished_tasks] == ["Overdue write-up"]
    assert result.tomorrow_priorities == ["Finish the write-up"]


def test_generate_daily_review_gathers_new_notes_and_decisions(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into notes (user_id, title, content, note_type, created_at)
            values (%s, 'Redis vs Postgres', 'notes...', 'note', %s)
            """,
            (TEST_USER_ID, datetime(2026, 8, 17, 9, 0)),
        )
        cur.execute(
            """
            insert into notes (user_id, title, content, note_type, created_at)
            values (%s, 'Chose Redis for the cache', 'decided to...', 'decision', %s)
            """,
            (TEST_USER_ID, datetime(2026, 8, 17, 10, 0)),
        )
    conn.commit()

    result = generate_daily_review(conn, FakeGeminiClient([]), TEST_USER_ID, REVIEW_DATE)

    assert [n["title"] for n in result.new_knowledge] == ["Redis vs Postgres"]
    assert [d["title"] for d in result.decisions] == ["Chose Redis for the cache"]


def test_generate_daily_review_gathers_at_risk_and_missed_blockers(conn):
    project_id = _insert_project(conn, TEST_USER_ID)
    at_risk_id = _insert_task(conn, TEST_USER_ID, project_id, "Can't fit it in", status="at_risk")
    missed_id = _insert_task(conn, TEST_USER_ID, project_id, "Missed slot", status="open")
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into time_blocks (user_id, task_id, starts_at, ends_at, status)
            values (%s, %s, %s, %s, 'missed')
            """,
            (TEST_USER_ID, missed_id, datetime(2026, 8, 17, 9, 0), datetime(2026, 8, 17, 10, 0)),
        )
    conn.commit()

    result = generate_daily_review(conn, FakeGeminiClient([]), TEST_USER_ID, REVIEW_DATE)

    blocker_ids = {b["id"] for b in result.blockers}
    assert str(at_risk_id) in blocker_ids
    assert str(missed_id) in blocker_ids
    reasons = {b["id"]: b["reason"] for b in result.blockers}
    assert reasons[str(at_risk_id)] == "at_risk"
    assert reasons[str(missed_id)] == "missed"


def test_generate_daily_review_skips_llm_call_on_an_empty_day(conn):
    client = FakeGeminiClient(["should not be used"])

    result = generate_daily_review(conn, client, TEST_USER_ID, REVIEW_DATE)

    assert client.calls == 0
    assert result.tomorrow_priorities == []
    assert result.completed_tasks == []
    assert result.unfinished_tasks == []
    assert result.blockers == []


def test_generate_daily_review_persists_and_logs_agent_action(conn):
    project_id = _insert_project(conn, TEST_USER_ID)
    _insert_task(
        conn,
        TEST_USER_ID,
        project_id,
        "Ship it",
        status="done",
        completed_at=datetime(2026, 8, 17, 14, 0),
    )

    result = generate_daily_review(conn, FakeGeminiClient(["Rest"]), TEST_USER_ID, REVIEW_DATE)

    with conn.cursor() as cur:
        cur.execute(
            "select review_date, completed_tasks, tomorrow_priorities from daily_reviews where id = %s",
            (result.id,),
        )
        row = cur.fetchone()
        assert row[0] == REVIEW_DATE
        assert len(row[1]) == 1
        assert row[2] == ["Rest"]

        cur.execute(
            "select agent_name, action_kind, target_type, target_id from agent_actions where user_id = %s",
            (TEST_USER_ID,),
        )
        action = cur.fetchone()
    assert action == ("review", "created", "daily_review", result.id)


def test_generate_daily_review_upserts_on_retrigger(conn):
    project_id = _insert_project(conn, TEST_USER_ID)
    _insert_task(
        conn,
        TEST_USER_ID,
        project_id,
        "Ship it",
        status="done",
        completed_at=datetime(2026, 8, 17, 14, 0),
    )
    first = generate_daily_review(conn, FakeGeminiClient(["First pass"]), TEST_USER_ID, REVIEW_DATE)

    _insert_task(
        conn,
        TEST_USER_ID,
        project_id,
        "Ship it too",
        status="done",
        completed_at=datetime(2026, 8, 17, 15, 0),
    )
    second = generate_daily_review(conn, FakeGeminiClient(["Second pass"]), TEST_USER_ID, REVIEW_DATE)

    assert second.id == first.id
    assert len(second.completed_tasks) == 2
    with conn.cursor() as cur:
        cur.execute("select count(*) from daily_reviews where user_id = %s", (TEST_USER_ID,))
        assert cur.fetchone()[0] == 1
