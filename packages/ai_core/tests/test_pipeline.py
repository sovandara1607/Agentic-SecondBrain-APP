import json
import os
import uuid

import psycopg
import pytest

import ai_core.pipeline as pipeline_module
from ai_core.pipeline import EMBEDDING_DIMENSIONS, process_capture

DATABASE_URL = os.environ["DATABASE_URL"]
TEST_USER_ID = "33333333-3333-3333-3333-333333333333"

BASE_PAYLOAD = {
    "tags": [],
    "entities": [],
    "project_name_match": None,
    "is_decision": False,
    "is_actionable": False,
    "task_title": None,
    "task_priority": None,
    "task_deadline": None,
    "needs_review": False,
}


def _vector(seed: float) -> list[float]:
    return [seed] * EMBEDDING_DIMENSIONS


class FakeGeminiClient:
    """Stands in for ai_core.client.GeminiClient - process_capture only calls
    client.chat.completions.create(...) (reading response.content),
    client.embeddings.create(...) (reading response.embedding), and, for
    voice/image/pdf captures, client.extract_text_from_media(...)."""

    def __init__(
        self,
        payload: dict,
        embedding: list[float] | None = None,
        extracted_text: str | None = None,
    ):
        self._payload = payload
        self._embedding = embedding or _vector(0.1)
        self._extracted_text = extracted_text
        self.chat = self
        self.completions = self
        self.embeddings = self
        self.extract_calls = []

    def create(self, **kwargs):
        if "messages" in kwargs:
            return type("ChatCompletion", (), {"content": json.dumps(self._payload)})
        return type("EmbeddingResponse", (), {"embedding": self._embedding})

    def extract_text_from_media(self, mime_type, data, prompt):
        self.extract_calls.append({"mime_type": mime_type, "data": data, "prompt": prompt})
        return self._extracted_text or ""


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


def _insert_media_capture(conn, kind: str, storage_path: str) -> uuid.UUID:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into captures (user_id, kind, storage_path)
            values (%s, %s, %s)
            returning id
            """,
            (TEST_USER_ID, kind, storage_path),
        )
        capture_id = cur.fetchone()[0]
    conn.commit()
    return capture_id


def test_process_capture_creates_note_tags_and_task(conn):
    capture_id = _insert_capture(conn, "Call the dentist by Friday to reschedule.")
    fake = FakeGeminiClient(
        {
            **BASE_PAYLOAD,
            "title": "Reschedule dentist appointment",
            "summary": "Need to call the dentist to reschedule before Friday.",
            "tags": ["health", "calls"],
            "is_actionable": True,
            "task_title": "Call the dentist to reschedule",
            "task_priority": 2,
            "task_deadline": "2026-08-14",
        }
    )

    result = process_capture(conn, capture_id, client=fake)

    with conn.cursor() as cur:
        cur.execute(
            "select title, ai_summary, capture_id, note_type from notes where id = %s",
            (result.note_id,),
        )
        title, ai_summary, note_capture_id, note_type = cur.fetchone()
        assert title == "Reschedule dentist appointment"
        assert ai_summary.startswith("Need to call the dentist")
        assert note_capture_id == capture_id
        assert note_type == "note"

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
            "select title, priority, capture_id, deadline from tasks where id = %s",
            (result.task_id,),
        )
        task_title, priority, task_capture_id, deadline = cur.fetchone()
        assert task_title == "Call the dentist to reschedule"
        assert priority == 2
        assert task_capture_id == capture_id
        assert deadline.date().isoformat() == "2026-08-14"

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

        # create_embeddings: one row for this note.
        cur.execute(
            "select chunk_index from embeddings where content_type = 'note' and content_id = %s",
            (result.note_id,),
        )
        assert cur.fetchone()[0] == 0


def test_process_capture_non_actionable_creates_no_task(conn):
    capture_id = _insert_capture(conn, "Interesting article about tide pools.")
    fake = FakeGeminiClient(
        {
            **BASE_PAYLOAD,
            "title": "Tide pools article",
            "summary": "An article about tide pool ecosystems.",
            "tags": ["reading"],
        }
    )

    result = process_capture(conn, capture_id, client=fake)

    assert result.task_id is None
    with conn.cursor() as cur:
        cur.execute("select count(*) from tasks where capture_id = %s", (capture_id,))
        assert cur.fetchone()[0] == 0


def test_process_capture_needs_review_sets_capture_status(conn):
    capture_id = _insert_capture(conn, "asdkjf partial thought, unclear")
    fake = FakeGeminiClient(
        {
            **BASE_PAYLOAD,
            "title": "Unclear note",
            "summary": "Fragmentary text, unclear intent.",
            "needs_review": True,
        }
    )

    process_capture(conn, capture_id, client=fake)

    with conn.cursor() as cur:
        cur.execute("select status from captures where id = %s", (capture_id,))
        assert cur.fetchone()[0] == "needs_review"


def test_process_capture_raises_for_missing_capture(conn):
    fake = FakeGeminiClient(BASE_PAYLOAD)
    with pytest.raises(ValueError, match="not found"):
        process_capture(conn, uuid.uuid4(), client=fake)


def test_process_capture_creates_entities_and_links_them(conn):
    capture_id = _insert_capture(conn, "Had lunch with Sarah to discuss the Q3 roadmap.")
    fake = FakeGeminiClient(
        {
            **BASE_PAYLOAD,
            "title": "Lunch with Sarah",
            "summary": "Discussed the Q3 roadmap over lunch with Sarah.",
            "entities": [
                {"name": "Sarah", "kind": "person"},
                {"name": "Q3 roadmap", "kind": "concept"},
            ],
        }
    )

    result = process_capture(conn, capture_id, client=fake)

    assert sorted(result.entities) == ["Q3 roadmap", "Sarah"]
    with conn.cursor() as cur:
        cur.execute(
            "select kind, name from entities where user_id = %s order by name",
            (TEST_USER_ID,),
        )
        assert cur.fetchall() == [("concept", "Q3 roadmap"), ("person", "Sarah")]

        cur.execute(
            """
            select count(*) from relationships
            where source_type = 'note' and source_id = %s
              and target_type = 'entity' and relation_kind = 'mentions'
            """,
            (result.note_id,),
        )
        assert cur.fetchone()[0] == 2


def test_process_capture_matches_existing_project(conn):
    with conn.cursor() as cur:
        cur.execute(
            "insert into projects (user_id, name) values (%s, 'Website Relaunch') returning id",
            (TEST_USER_ID,),
        )
        project_id = cur.fetchone()[0]
    conn.commit()

    capture_id = _insert_capture(conn, "Finalize the homepage copy for the relaunch.")
    fake = FakeGeminiClient(
        {
            **BASE_PAYLOAD,
            "title": "Homepage copy",
            "summary": "Finalize homepage copy for the site relaunch.",
            "project_name_match": "Website Relaunch",
            "is_actionable": True,
            "task_title": "Finalize homepage copy",
            "task_priority": 2,
        }
    )

    result = process_capture(conn, capture_id, client=fake)

    with conn.cursor() as cur:
        cur.execute("select project_id from notes where id = %s", (result.note_id,))
        assert cur.fetchone()[0] == project_id
        cur.execute("select project_id from tasks where id = %s", (result.task_id,))
        assert cur.fetchone()[0] == project_id


def test_process_capture_decision_sets_note_type(conn):
    capture_id = _insert_capture(conn, "We decided to go with the vendor proposal.")
    fake = FakeGeminiClient(
        {
            **BASE_PAYLOAD,
            "title": "Vendor decision",
            "summary": "Decided to go with the vendor proposal.",
            "is_decision": True,
        }
    )

    result = process_capture(conn, capture_id, client=fake)

    with conn.cursor() as cur:
        cur.execute("select note_type from notes where id = %s", (result.note_id,))
        assert cur.fetchone()[0] == "decision"


def test_process_capture_links_related_notes_above_threshold(conn):
    # First capture, gets an embedding vector that's identical to the
    # second's (cosine similarity 1.0, comfortably above the threshold).
    capture_1 = _insert_capture(conn, "Notes on the design system color palette.")
    process_capture(
        conn,
        capture_1,
        client=FakeGeminiClient(
            {**BASE_PAYLOAD, "title": "Design system colors", "summary": "Color palette notes."},
            embedding=_vector(0.5),
        ),
    )

    capture_2 = _insert_capture(conn, "More notes on the design system color palette.")
    result = process_capture(
        conn,
        capture_2,
        client=FakeGeminiClient(
            {**BASE_PAYLOAD, "title": "More on colors", "summary": "More color palette notes."},
            embedding=_vector(0.5),
        ),
    )

    assert len(result.related_note_ids) == 1
    with conn.cursor() as cur:
        cur.execute(
            """
            select relation_kind, weight from relationships
            where source_type = 'note' and source_id = %s and target_type = 'note'
            """,
            (result.note_id,),
        )
        relation_kind, weight = cur.fetchone()
        assert relation_kind == "relates_to"
        assert weight > 0.99


def test_process_capture_transcribes_a_voice_capture_before_running_the_pipeline(conn, monkeypatch):
    monkeypatch.setattr(pipeline_module, "download_capture_object", lambda path: b"fake-audio-bytes")
    capture_id = _insert_media_capture(conn, "voice", f"{TEST_USER_ID}/note.webm")
    client = FakeGeminiClient(
        {**BASE_PAYLOAD, "title": "Voice memo", "summary": "A transcribed thought."},
        extracted_text="Remember to call the dentist tomorrow.",
    )

    result = process_capture(conn, capture_id, client=client)

    assert client.extract_calls == [
        {
            "mime_type": "audio/webm",
            "data": b"fake-audio-bytes",
            "prompt": pipeline_module._EXTRACTION_PROMPTS["voice"],
        }
    ]
    with conn.cursor() as cur:
        cur.execute("select raw_text, status from captures where id = %s", (capture_id,))
        raw_text, status = cur.fetchone()
    assert raw_text == "Remember to call the dentist tomorrow."
    assert status == "organized"
    with conn.cursor() as cur:
        cur.execute("select content from notes where id = %s", (result.note_id,))
        assert cur.fetchone()[0] == "Remember to call the dentist tomorrow."


def test_process_capture_extracts_text_from_a_pdf_capture(conn, monkeypatch):
    monkeypatch.setattr(pipeline_module, "download_capture_object", lambda path: b"fake-pdf-bytes")
    capture_id = _insert_media_capture(conn, "pdf", f"{TEST_USER_ID}/doc.pdf")
    client = FakeGeminiClient(
        {**BASE_PAYLOAD, "title": "Contract", "summary": "A contract."},
        extracted_text="This agreement is made between...",
    )

    process_capture(conn, capture_id, client=client)

    assert client.extract_calls[0]["mime_type"] == "application/pdf"
    with conn.cursor() as cur:
        cur.execute("select raw_text from captures where id = %s", (capture_id,))
        assert cur.fetchone()[0] == "This agreement is made between..."


def test_process_capture_raises_for_unsupported_file_extension(conn, monkeypatch):
    monkeypatch.setattr(pipeline_module, "download_capture_object", lambda path: b"data")
    capture_id = _insert_media_capture(conn, "voice", f"{TEST_USER_ID}/note.aiff")
    client = FakeGeminiClient(BASE_PAYLOAD)

    with pytest.raises(ValueError, match="unsupported file type"):
        process_capture(conn, capture_id, client=client)


def test_process_capture_raises_when_extraction_returns_nothing(conn, monkeypatch):
    monkeypatch.setattr(pipeline_module, "download_capture_object", lambda path: b"silence")
    capture_id = _insert_media_capture(conn, "voice", f"{TEST_USER_ID}/silent.webm")
    client = FakeGeminiClient(BASE_PAYLOAD, extracted_text="   ")

    with pytest.raises(ValueError, match="no text could be extracted"):
        process_capture(conn, capture_id, client=client)
