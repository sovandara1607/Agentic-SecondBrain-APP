import json
import os
import uuid

import psycopg
import pytest

from ai_core.agents.planner import ProjectNotFoundError, decompose_project

DATABASE_URL = os.environ["DATABASE_URL"]
TEST_USER_ID = "66666666-6666-6666-6666-666666666666"
OTHER_USER_ID = "55555555-5555-5555-5555-555555555555"


class FakeGeminiClient:
    """Stands in for ai_core.client.GeminiClient - decompose_project only calls
    client.chat.completions.create(...) with response_format=json_schema,
    reading response.content as a JSON string."""

    def __init__(self, plan: dict):
        self._plan = plan
        self.chat = self
        self.completions = self

    def create(self, **_kwargs):
        return type("ChatCompletion", (), {"content": json.dumps(self._plan)})


@pytest.fixture
def conn():
    with psycopg.connect(DATABASE_URL, autocommit=False) as connection:
        with connection.cursor() as cur:
            cur.execute(
                """
                insert into auth.users (id, email, encrypted_password)
                values (%s, 'phase3-planner-test@example.com', 'x')
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
            "insert into projects (user_id, name, overview) values (%s, %s, %s) returning id",
            (user_id, name, "A learning management system for indie courses."),
        )
        project_id = cur.fetchone()[0]
    conn.commit()
    return project_id


MYLMS_PLAN = {
    "groups": [
        {
            "name": "Planning",
            "depends_on_groups": [],
            "tasks": [
                {"title": "Define MVP scope", "estimated_minutes": 60, "energy_level": "high", "priority": 1},
                {"title": "Write requirements doc", "estimated_minutes": 90, "energy_level": "medium", "priority": 2},
            ],
        },
        {
            "name": "Development",
            "depends_on_groups": ["Planning"],
            "tasks": [
                {"title": "Build auth", "estimated_minutes": 240, "energy_level": "high", "priority": 1},
                {"title": "Build course player", "estimated_minutes": 300, "energy_level": "high", "priority": 2},
            ],
        },
        {
            "name": "Testing",
            "depends_on_groups": ["Development"],
            "tasks": [
                {"title": "Write test plan", "estimated_minutes": 45, "energy_level": "medium", "priority": 3},
            ],
        },
    ]
}


def test_decompose_project_creates_tasks_for_every_group(conn):
    project_id = _insert_project(conn, TEST_USER_ID)

    result = decompose_project(conn, FakeGeminiClient(MYLMS_PLAN), TEST_USER_ID, project_id, "Launch MyLMS")

    assert result.total_tasks == 5
    assert [g.name for g in result.groups] == ["Planning", "Development", "Testing"]

    with conn.cursor() as cur:
        cur.execute("select count(*) from tasks where project_id = %s", (project_id,))
        assert cur.fetchone()[0] == 5


def test_decompose_project_links_each_task_to_the_project(conn):
    project_id = _insert_project(conn, TEST_USER_ID)

    result = decompose_project(conn, FakeGeminiClient(MYLMS_PLAN), TEST_USER_ID, project_id, "Launch MyLMS")

    all_task_ids = {t for g in result.groups for t in g.task_ids}
    with conn.cursor() as cur:
        cur.execute(
            "select source_id from relationships where target_type = 'project' and target_id = %s and relation_kind = 'part_of'",
            (project_id,),
        )
        linked = {row[0] for row in cur.fetchall()}
    assert linked == all_task_ids


def test_decompose_project_expands_group_dependencies_to_every_leaf_pair(conn):
    project_id = _insert_project(conn, TEST_USER_ID)

    result = decompose_project(conn, FakeGeminiClient(MYLMS_PLAN), TEST_USER_ID, project_id, "Launch MyLMS")

    planning_ids = result.groups[0].task_ids
    development_ids = result.groups[1].task_ids
    testing_ids = result.groups[2].task_ids

    with conn.cursor() as cur:
        cur.execute("select task_id, depends_on_task_id from task_dependencies")
        deps = set(cur.fetchall())

    # Development depends on Planning: every dev task blocked on every planning task.
    for d in development_ids:
        for p in planning_ids:
            assert (d, p) in deps
    # Testing depends on Development: every testing task blocked on every dev task.
    for t in testing_ids:
        for d in development_ids:
            assert (t, d) in deps
    # Planning has no prerequisites.
    assert not any(task_id in planning_ids for task_id, _ in deps)


def test_decompose_project_logs_agent_action(conn):
    project_id = _insert_project(conn, TEST_USER_ID)

    decompose_project(conn, FakeGeminiClient(MYLMS_PLAN), TEST_USER_ID, project_id, "Launch MyLMS")

    with conn.cursor() as cur:
        cur.execute(
            "select agent_name, action_kind, target_type, target_id, summary from agent_actions where user_id = %s",
            (TEST_USER_ID,),
        )
        row = cur.fetchone()
    assert row[:4] == ("planner", "created", "project", project_id)
    assert "5 tasks" in row[4]


def test_decompose_project_raises_for_missing_project(conn):
    with pytest.raises(ProjectNotFoundError):
        decompose_project(conn, FakeGeminiClient(MYLMS_PLAN), TEST_USER_ID, uuid.uuid4(), "Launch MyLMS")


def test_decompose_project_raises_for_project_owned_by_another_user(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into auth.users (id, email, encrypted_password)
            values (%s, 'phase3-planner-other-test@example.com', 'x')
            on conflict (id) do nothing
            """,
            (OTHER_USER_ID,),
        )
    conn.commit()
    other_project_id = _insert_project(conn, OTHER_USER_ID, "Someone else's project")

    try:
        with pytest.raises(ProjectNotFoundError):
            decompose_project(conn, FakeGeminiClient(MYLMS_PLAN), TEST_USER_ID, other_project_id, "Launch MyLMS")
    finally:
        with conn.cursor() as cur:
            cur.execute("delete from auth.users where id = %s", (OTHER_USER_ID,))
        conn.commit()


def test_decompose_project_handles_empty_plan(conn):
    project_id = _insert_project(conn, TEST_USER_ID)

    result = decompose_project(conn, FakeGeminiClient({"groups": []}), TEST_USER_ID, project_id, "Launch MyLMS")

    assert result.total_tasks == 0
    with conn.cursor() as cur:
        cur.execute("select count(*) from agent_actions where user_id = %s", (TEST_USER_ID,))
        assert cur.fetchone()[0] == 1
