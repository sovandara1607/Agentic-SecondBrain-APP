import os
import uuid

import psycopg
import pytest

from ai_core.agents.writer import NoteNotFoundError, draft_document

DATABASE_URL = os.environ["DATABASE_URL"]
TEST_USER_ID = "99999999-9999-9999-9999-999999999999"
OTHER_USER_ID = "10101010-1010-1010-1010-101010101010"


class FakeGeminiClient:
    """Stands in for ai_core.client.GeminiClient - draft_document calls
    client.embeddings.create(...) (via ai_core.context.build_context) and
    client.chat.completions.create(...) (non-streaming, reading .content)."""

    def __init__(self, draft_content: str, embedding: list[float] | None = None):
        self._draft_content = draft_content
        self._embedding = embedding or [0.1] * 768
        self.chat = self
        self.completions = self
        self.embeddings = self
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if "messages" in kwargs:
            return type("ChatCompletion", (), {"content": self._draft_content})
        return type("EmbeddingResponse", (), {"embedding": self._embedding})


@pytest.fixture
def conn():
    with psycopg.connect(DATABASE_URL, autocommit=False) as connection:
        with connection.cursor() as cur:
            cur.execute(
                """
                insert into auth.users (id, email, encrypted_password)
                values (%s, 'phase3-writer-test@example.com', 'x')
                on conflict (id) do nothing
                """,
                (TEST_USER_ID,),
            )
        connection.commit()
        yield connection
        with connection.cursor() as cur:
            cur.execute("delete from auth.users where id = %s", (TEST_USER_ID,))
        connection.commit()


def test_draft_document_creates_a_summary_note(conn):
    client = FakeGeminiClient("# Investor update\n\nThings are going well.")

    result = draft_document(conn, client, TEST_USER_ID, "Draft an investor update", "email")

    assert result.action == "created"
    assert result.title == "Investor update"
    assert result.doc_type == "email"

    with conn.cursor() as cur:
        cur.execute(
            "select title, content, note_type from notes where id = %s", (result.note_id,)
        )
        row = cur.fetchone()
    assert row == ("Investor update", "# Investor update\n\nThings are going well.", "summary")


def test_draft_document_falls_back_to_document_for_unknown_doc_type(conn):
    client = FakeGeminiClient("# Something\n\nBody.")

    result = draft_document(conn, client, TEST_USER_ID, "Write something", "not-a-real-type")

    assert result.doc_type == "document"


def test_draft_document_titles_from_prompt_when_model_returns_no_heading(conn):
    client = FakeGeminiClient("")

    result = draft_document(conn, client, TEST_USER_ID, "Draft interview answers about my last job")

    assert result.title == "Draft interview answers about my last job"


def test_draft_document_logs_agent_action(conn):
    client = FakeGeminiClient("# Report\n\nBody.")

    result = draft_document(conn, client, TEST_USER_ID, "Draft a report", "report")

    with conn.cursor() as cur:
        cur.execute(
            "select agent_name, action_kind, target_type, target_id from agent_actions where user_id = %s",
            (TEST_USER_ID,),
        )
        action = cur.fetchone()
    assert action == ("writer", "created", "note", result.note_id)


def test_draft_document_refines_an_existing_note_in_place(conn):
    with conn.cursor() as cur:
        cur.execute(
            "insert into notes (user_id, title, content, note_type) values (%s, %s, %s, 'summary') returning id",
            (TEST_USER_ID, "Investor update", "# Investor update\n\nOld draft."),
        )
        note_id = cur.fetchone()[0]
    conn.commit()

    client = FakeGeminiClient("# Investor update\n\nRevised, tighter version.")
    result = draft_document(
        conn, client, TEST_USER_ID, "Make it punchier", "email", existing_note_id=note_id
    )

    assert result.action == "updated"
    assert result.note_id == note_id
    assert result.title == "Investor update"  # kept the original title, not re-derived

    # Passed the old draft along for the model to revise, not just the new prompt.
    chat_call = next(c for c in client.calls if "messages" in c)
    assert "Old draft." in chat_call["messages"][1]["content"]

    with conn.cursor() as cur:
        cur.execute("select content from notes where id = %s", (note_id,))
        assert cur.fetchone()[0] == "# Investor update\n\nRevised, tighter version."
        cur.execute("select count(*) from notes where user_id = %s", (TEST_USER_ID,))
        assert cur.fetchone()[0] == 1  # updated in place, not duplicated


def test_draft_document_raises_for_missing_existing_note(conn):
    client = FakeGeminiClient("# X\n\nY.")

    with pytest.raises(NoteNotFoundError):
        draft_document(conn, client, TEST_USER_ID, "revise it", existing_note_id=uuid.uuid4())


def test_draft_document_raises_for_note_owned_by_another_user(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into auth.users (id, email, encrypted_password)
            values (%s, 'phase3-writer-other-test@example.com', 'x')
            on conflict (id) do nothing
            """,
            (OTHER_USER_ID,),
        )
        cur.execute(
            "insert into notes (user_id, title, content) values (%s, 'Not yours', 'x') returning id",
            (OTHER_USER_ID,),
        )
        other_note_id = cur.fetchone()[0]
    conn.commit()

    client = FakeGeminiClient("# X\n\nY.")
    try:
        with pytest.raises(NoteNotFoundError):
            draft_document(
                conn, client, TEST_USER_ID, "revise it", existing_note_id=other_note_id
            )
    finally:
        with conn.cursor() as cur:
            cur.execute("delete from auth.users where id = %s", (OTHER_USER_ID,))
        conn.commit()
