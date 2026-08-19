import json
import os
import uuid
from datetime import date

import psycopg
import pytest

from ai_core.agents.review import generate_monthly_review

DATABASE_URL = os.environ["DATABASE_URL"]
TEST_USER_ID = "19191919-1919-1919-1919-191919191919"
MONTH_START = date(2026, 8, 1)


class FakeGeminiClient:
    """Stands in for ai_core.client.GeminiClient - generate_monthly_review only
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
                values (%s, 'phase-monthly-review-test@example.com', 'x')
                on conflict (id) do nothing
                """,
                (TEST_USER_ID,),
            )
        connection.commit()
        yield connection
        with connection.cursor() as cur:
            cur.execute("delete from auth.users where id = %s", (TEST_USER_ID,))
        connection.commit()


def _insert_weekly_review(
    conn,
    week_start: date,
    project_progress=None,
    knowledge_learned=None,
    time_allocation=None,
    missed_deadlines=None,
) -> uuid.UUID:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into weekly_reviews
                (user_id, week_start, project_progress, knowledge_learned, time_allocation, missed_deadlines)
            values (%s, %s, %s, %s, %s, %s)
            returning id
            """,
            (
                TEST_USER_ID,
                week_start,
                json.dumps(project_progress or []),
                json.dumps(knowledge_learned or []),
                json.dumps(time_allocation or {}),
                json.dumps(missed_deadlines or []),
            ),
        )
        review_id = cur.fetchone()[0]
    conn.commit()
    return review_id


def test_generate_monthly_review_skips_llm_when_no_weekly_reviews_exist(conn):
    client = FakeGeminiClient(["should not be used"])

    result = generate_monthly_review(conn, client, TEST_USER_ID, MONTH_START)

    assert client.calls == 0
    assert result.weeks_included == 0
    assert result.recommendations == []


def test_generate_monthly_review_rolls_up_multiple_weeks(conn):
    project_id = str(uuid.uuid4())
    _insert_weekly_review(
        conn, date(2026, 8, 3),
        project_progress=[{"id": project_id, "name": "MyLMS", "progress": 30, "completed_this_week": 2}],
        knowledge_learned=[{"id": "n1", "title": "Note 1"}],
        time_allocation={"MyLMS": 60},
        missed_deadlines=[{"id": "t1", "title": "Late task"}],
    )
    _insert_weekly_review(
        conn, date(2026, 8, 10),
        project_progress=[{"id": project_id, "name": "MyLMS", "progress": 55, "completed_this_week": 3}],
        knowledge_learned=[{"id": "n2", "title": "Note 2"}, {"id": "n3", "title": "Note 3"}],
        time_allocation={"MyLMS": 90},
        missed_deadlines=[],
    )
    client = FakeGeminiClient(["Push harder on MyLMS"])

    result = generate_monthly_review(conn, client, TEST_USER_ID, MONTH_START)

    assert result.weeks_included == 2
    assert result.knowledge_learned_count == 3
    assert result.missed_deadlines_count == 1
    assert result.time_allocation == {"MyLMS": 150}

    assert len(result.project_progress) == 1
    proj = result.project_progress[0]
    assert proj["latest_progress"] == 55  # from the later week, not averaged
    assert proj["completed_this_month"] == 5  # 2 + 3


def test_generate_monthly_review_excludes_weeks_outside_the_month(conn):
    _insert_weekly_review(conn, date(2026, 7, 27))  # week straddling into August, still July-start
    _insert_weekly_review(conn, date(2026, 9, 7))  # next month entirely
    client = FakeGeminiClient([])

    result = generate_monthly_review(conn, client, TEST_USER_ID, MONTH_START)

    assert result.weeks_included == 0


def test_generate_monthly_review_persists_and_logs_agent_action(conn):
    _insert_weekly_review(conn, date(2026, 8, 3))
    client = FakeGeminiClient(["Rest"])

    result = generate_monthly_review(conn, client, TEST_USER_ID, MONTH_START)

    with conn.cursor() as cur:
        cur.execute(
            "select month_start, weeks_included, recommendations from monthly_reviews where id = %s",
            (result.id,),
        )
        row = cur.fetchone()
        assert row[0] == MONTH_START
        assert row[1] == 1
        assert row[2] == ["Rest"]

        cur.execute(
            "select agent_name, action_kind, target_type, target_id from agent_actions where user_id = %s",
            (TEST_USER_ID,),
        )
        action = cur.fetchone()
    assert action == ("review", "created", "monthly_review", result.id)


def test_generate_monthly_review_upserts_on_retrigger(conn):
    _insert_weekly_review(conn, date(2026, 8, 3))
    first = generate_monthly_review(conn, FakeGeminiClient(["First"]), TEST_USER_ID, MONTH_START)

    _insert_weekly_review(conn, date(2026, 8, 10))
    second = generate_monthly_review(conn, FakeGeminiClient(["Second"]), TEST_USER_ID, MONTH_START)

    assert second.id == first.id
    assert second.weeks_included == 2
    with conn.cursor() as cur:
        cur.execute("select count(*) from monthly_reviews where user_id = %s", (TEST_USER_ID,))
        assert cur.fetchone()[0] == 1
