import json
import os
import uuid

import psycopg
import pytest

from ai_core.pipeline import process_capture

DATABASE_URL = os.environ["DATABASE_URL"]
TEST_USER_ID = "33333333-3333-3333-3333-333333333333"


class FakeOpenAI:
    """Stands in for openai.OpenAI - process_capture only ever calls
    client.chat.completions.create(...) and reads
    response.choices[0].message.content, so that's all this fakes."""

    def __init__(self, payload: dict):
        self._payload = payload
        self.chat = self
        self.completions = self

    def create(self, **_kwargs):
        message = type("Message", (), {"content": json.dumps(self._payload)})
        choice = type("Choice", (), {"message": message})
        return type("Response", (), {"choices": [choice]})


@pytest.fixture
def conn():
    with psycopg.connect(DATABASE_URL, autocommit=False) as connection:
        with connection.cursor() as cur:
            cur.execute(
                """
                insert into auth.users (id, email, encrypted_password)
                values (%s, 'phase1-pipeline-test@example.com', 'x')
                on conflict (id) do nothing
                """,
                (TEST_USER_ID,),
            )
        connection.commit()
        yield connection
        with connection.cursor() as cur:
            cur.execute("delete from auth.users where id = %s", (TEST_USER_ID,))
        connection.commit()


def _insert_capture(conn, raw_text: str) -> uuid.UUID:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into captures (user_id, kind, raw_text)
            values (%s, 'text', %s)
            returning id
            """,
            (TEST_USER_ID, raw_text),
        )
        capture_id = cur.fetchone()[0]
    conn.commit()
    return capture_id


def test_process_capture_creates_note_tags_and_task(conn):
    capture_id = _insert_capture(conn, "Call the dentist by Friday to reschedule.")
    fake = FakeOpenAI(
        {
            "title": "Reschedule dentist appointment",
            "summary": "Need to call the dentist to reschedule before Friday.",
            "tags": ["health", "calls"],
            "is_actionable": True,
            "task_title": "Call the dentist to reschedule",
            "task_priority": 2,
            "needs_review": False,
        }
    )

    result = process_capture(conn, capture_id, client=fake)

    with conn.cursor() as cur:
        cur.execute(
            "select title, ai_summary, capture_id from notes where id = %s",
            (result.note_id,),
        )
        title, ai_summary, note_capture_id = cur.fetchone()
        assert title == "Reschedule dentist appointment"
        assert ai_summary.startswith("Need to call the dentist")
        assert note_capture_id == capture_id

        cur.execute(
            """
            select t.name from tags t
            join taggables tg on tg.tag_id = t.id
            where tg.taggable_type = 'note' and tg.taggable_id = %s
            order by t.name
            """,
            (result.note_id,),
        )
        assert [row[0] for row in cur.fetchall()] == ["calls", "health"]

        assert result.task_id is not None
        cur.execute(
            "select title, priority, capture_id from tasks where id = %s",
            (result.task_id,),
        )
        task_title, priority, task_capture_id = cur.fetchone()
        assert task_title == "Call the dentist to reschedule"
        assert priority == 2
        assert task_capture_id == capture_id

        cur.execute("select status, processed_at from captures where id = %s", (capture_id,))
        status, processed_at = cur.fetchone()
        assert status == "organized"
        assert processed_at is not None

        cur.execute(
            "select agent_name, action_kind, target_id from agent_actions where target_id = %s",
            (result.note_id,),
        )
        agent_name, action_kind, target_id = cur.fetchone()
        assert agent_name == "pipeline"
        assert action_kind == "created"
        assert target_id == result.note_id


def test_process_capture_non_actionable_creates_no_task(conn):
    capture_id = _insert_capture(conn, "Interesting article about tide pools.")
    fake = FakeOpenAI(
        {
            "title": "Tide pools article",
            "summary": "An article about tide pool ecosystems.",
            "tags": ["reading"],
            "is_actionable": False,
            "task_title": None,
            "task_priority": None,
            "needs_review": False,
        }
    )

    result = process_capture(conn, capture_id, client=fake)

    assert result.task_id is None
    with conn.cursor() as cur:
        cur.execute("select count(*) from tasks where capture_id = %s", (capture_id,))
        assert cur.fetchone()[0] == 0


def test_process_capture_needs_review_sets_capture_status(conn):
    capture_id = _insert_capture(conn, "asdkjf partial thought, unclear")
    fake = FakeOpenAI(
        {
            "title": "Unclear note",
            "summary": "Fragmentary text, unclear intent.",
            "tags": [],
            "is_actionable": False,
            "task_title": None,
            "task_priority": None,
            "needs_review": True,
        }
    )

    process_capture(conn, capture_id, client=fake)

    with conn.cursor() as cur:
        cur.execute("select status from captures where id = %s", (capture_id,))
        assert cur.fetchone()[0] == "needs_review"


def test_process_capture_raises_for_missing_capture(conn):
    fake = FakeOpenAI({})
    with pytest.raises(ValueError, match="not found"):
        process_capture(conn, uuid.uuid4(), client=fake)
