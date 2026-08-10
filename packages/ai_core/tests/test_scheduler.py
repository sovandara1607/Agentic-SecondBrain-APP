import json
import os
import uuid
from datetime import datetime, timedelta, timezone

import psycopg
import pytest

from ai_core.scheduler import run_missed_task_pass, run_scheduler

DATABASE_URL = os.environ["DATABASE_URL"]
TEST_USER_ID = "77777777-7777-7777-7777-777777777777"


@pytest.fixture
def conn():
    with psycopg.connect(DATABASE_URL, autocommit=False) as connection:
        with connection.cursor() as cur:
            cur.execute(
                """
                insert into auth.users (id, email, encrypted_password)
                values (%s, 'phase2-scheduler-test@example.com', 'x')
                on conflict (id) do nothing
                """,
                (TEST_USER_ID,),
            )
            # Wide-open, every-day-is-a-workday profile so tests aren't
            # sensitive to which real-world weekday they happen to run on.
            cur.execute(
                """
                update profiles set
                    working_hours = %s,
                    energy_profile = %s,
                    scheduler_weights = %s
                where id = %s
                """,
                (
                    json.dumps({"start": "08:00", "end": "20:00", "days": [1, 2, 3, 4, 5, 6, 7]}),
                    json.dumps({"morning": "high", "afternoon": "medium", "evening": "low"}),
                    json.dumps({"urgency": 0.5, "priority": 0.3, "project_weight": 0.2}),
                    TEST_USER_ID,
                ),
            )
        connection.commit()
        yield connection
        with connection.cursor() as cur:
            cur.execute("delete from auth.users where id = %s", (TEST_USER_ID,))
        connection.commit()


def _insert_task(
    conn,
    title: str,
    *,
    priority: int = 3,
    energy_level: str = "medium",
    estimated_minutes: int = 30,
    deadline: datetime | None = None,
    project_id: uuid.UUID | None = None,
) -> uuid.UUID:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into tasks (user_id, title, priority, energy_level, estimated_minutes, deadline, project_id)
            values (%s, %s, %s, %s, %s, %s, %s)
            returning id
            """,
            (TEST_USER_ID, title, priority, energy_level, estimated_minutes, deadline, project_id),
        )
        task_id = cur.fetchone()[0]
    conn.commit()
    return task_id


def test_run_scheduler_places_task_in_matching_energy_slot(conn):
    task_id = _insert_task(conn, "Deep work block", energy_level="high", estimated_minutes=60)

    result = run_scheduler(conn, TEST_USER_ID)

    assert task_id in [t for t, _, _ in result.placed]
    with conn.cursor() as cur:
        cur.execute("select status from tasks where id = %s", (task_id,))
        assert cur.fetchone()[0] == "scheduled"
        cur.execute(
            "select starts_at, ends_at from time_blocks where task_id = %s", (task_id,)
        )
        starts_at, ends_at = cur.fetchone()
        # morning = energy_profile "high", matching the task's energy_level.
        assert starts_at.hour < 12
        assert (ends_at - starts_at).total_seconds() / 60 == 60


def test_run_scheduler_skips_tasks_with_incomplete_dependency(conn):
    blocker_id = _insert_task(conn, "Blocker task")
    blocked_id = _insert_task(conn, "Blocked task")
    with conn.cursor() as cur:
        cur.execute(
            "insert into task_dependencies (task_id, depends_on_task_id) values (%s, %s)",
            (blocked_id, blocker_id),
        )
    conn.commit()

    result = run_scheduler(conn, TEST_USER_ID)

    placed_ids = [t for t, _, _ in result.placed]
    assert blocker_id in placed_ids
    assert blocked_id not in placed_ids
    with conn.cursor() as cur:
        cur.execute("select status from tasks where id = %s", (blocked_id,))
        assert cur.fetchone()[0] == "open"


def test_run_scheduler_marks_unplaceable_task_at_risk(conn):
    with conn.cursor() as cur:
        cur.execute(
            "insert into projects (user_id, name) values (%s, 'At Risk Project') returning id",
            (TEST_USER_ID,),
        )
        project_id = cur.fetchone()[0]
    conn.commit()

    # Due today, but needs far more time than a single workday has -
    # guaranteed unplaceable regardless of what day tests run on.
    today_end = datetime.now(timezone.utc).replace(hour=23, minute=59, second=0, microsecond=0)
    task_id = _insert_task(
        conn,
        "Impossible task",
        estimated_minutes=10_000,
        deadline=today_end,
        project_id=project_id,
    )

    result = run_scheduler(conn, TEST_USER_ID)

    assert task_id in result.at_risk
    with conn.cursor() as cur:
        cur.execute("select status from tasks where id = %s", (task_id,))
        assert cur.fetchone()[0] == "at_risk"
        cur.execute("select risks from projects where id = %s", (project_id,))
        risks = cur.fetchone()[0]
        assert any(r.get("task_id") == str(task_id) for r in risks)


def test_run_scheduler_does_not_double_book_existing_time_block(conn):
    task_id = _insert_task(conn, "Needs a slot", estimated_minutes=30)

    # Occupy the entire working day (08:00-20:00 UTC, per the fixture's
    # profile) with an unrelated existing block before scheduling.
    today = datetime.now(timezone.utc)
    busy_start = today.replace(hour=8, minute=0, second=0, microsecond=0)
    busy_end = today.replace(hour=20, minute=0, second=0, microsecond=0)
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into tasks (user_id, title) values (%s, 'Occupies the day') returning id
            """,
            (TEST_USER_ID,),
        )
        other_task_id = cur.fetchone()[0]
        cur.execute(
            """
            insert into time_blocks (user_id, task_id, starts_at, ends_at, status)
            values (%s, %s, %s, %s, 'scheduled')
            """,
            (TEST_USER_ID, other_task_id, busy_start, busy_end),
        )
    conn.commit()

    result = run_scheduler(conn, TEST_USER_ID)

    placed = dict((t, (s, e)) for t, s, e in result.placed)
    assert task_id in placed
    starts_at, _ = placed[task_id]
    # Must land on a later day, not inside the fully-booked today.
    assert starts_at.date() > today.date()


def test_run_missed_task_pass_releases_missed_block(conn):
    task_id = _insert_task(conn, "Missed task")
    past = datetime.now(timezone.utc) - timedelta(hours=2)
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into time_blocks (user_id, task_id, starts_at, ends_at, status)
            values (%s, %s, %s, %s, 'scheduled')
            returning id
            """,
            (TEST_USER_ID, task_id, past - timedelta(hours=1), past),
        )
        block_id = cur.fetchone()[0]
        cur.execute("update tasks set status = 'scheduled' where id = %s", (task_id,))
    conn.commit()

    result = run_missed_task_pass(conn)

    assert task_id in result.released
    with conn.cursor() as cur:
        cur.execute("select status from time_blocks where id = %s", (block_id,))
        assert cur.fetchone()[0] == "missed"
        cur.execute("select status from tasks where id = %s", (task_id,))
        assert cur.fetchone()[0] == "open"


def test_run_missed_task_pass_ignores_done_tasks(conn):
    task_id = _insert_task(conn, "Already finished")
    past = datetime.now(timezone.utc) - timedelta(hours=2)
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into time_blocks (user_id, task_id, starts_at, ends_at, status)
            values (%s, %s, %s, %s, 'scheduled')
            """,
            (TEST_USER_ID, task_id, past - timedelta(hours=1), past),
        )
        cur.execute("update tasks set status = 'done' where id = %s", (task_id,))
    conn.commit()

    result = run_missed_task_pass(conn)

    assert task_id not in result.released
    with conn.cursor() as cur:
        cur.execute("select status from time_blocks where task_id = %s", (task_id,))
        assert cur.fetchone()[0] == "scheduled"
