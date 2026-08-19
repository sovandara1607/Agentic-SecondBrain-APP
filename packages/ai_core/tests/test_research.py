import os

import psycopg
import pytest

import ai_core.agents.research as research_module
from ai_core.agents.research import NoSourcesFetchedError, synthesize_research
from ai_core.webfetch import FetchError

DATABASE_URL = os.environ["DATABASE_URL"]
TEST_USER_ID = "18181818-1818-1818-1818-181818181818"


class FakeGeminiClient:
    """Stands in for ai_core.client.GeminiClient - synthesize_research only
    calls client.chat.completions.create(...) (non-streaming, reading
    .content)."""

    def __init__(self, content: str):
        self._content = content
        self.chat = self
        self.completions = self
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return type("ChatCompletion", (), {"content": self._content})


@pytest.fixture
def conn():
    with psycopg.connect(DATABASE_URL, autocommit=False) as connection:
        with connection.cursor() as cur:
            cur.execute(
                """
                insert into auth.users (id, email, encrypted_password)
                values (%s, 'phase-research-test@example.com', 'x')
                on conflict (id) do nothing
                """,
                (TEST_USER_ID,),
            )
        connection.commit()
        yield connection
        with connection.cursor() as cur:
            cur.execute("delete from auth.users where id = %s", (TEST_USER_ID,))
        connection.commit()


def _fake_fetch(pages: dict[str, str]):
    def fetch(url):
        if url not in pages:
            raise FetchError(f"couldn't fetch {url}")
        return pages[url]

    return fetch


def test_synthesize_research_creates_a_summary_note(conn, monkeypatch):
    monkeypatch.setattr(
        research_module,
        "fetch_url_text",
        _fake_fetch({"https://a.example.com": "Page A says X.", "https://b.example.com": "Page B says Y."}),
    )
    client = FakeGeminiClient("# Redis vs Postgres for caching\n\nBoth sources agree caching helps.")

    result = synthesize_research(
        conn, client, TEST_USER_ID, "Redis vs Postgres for caching",
        ["https://a.example.com", "https://b.example.com"],
    )

    assert result.title == "Redis vs Postgres for caching"
    assert "Both sources agree" in result.content
    assert len(result.sources) == 2
    assert all(s.fetched for s in result.sources)

    with conn.cursor() as cur:
        cur.execute("select title, note_type from notes where id = %s", (result.note_id,))
        title, note_type = cur.fetchone()
    assert title == "Redis vs Postgres for caching"
    assert note_type == "summary"


def test_synthesize_research_includes_a_sources_section(conn, monkeypatch):
    monkeypatch.setattr(
        research_module, "fetch_url_text", _fake_fetch({"https://a.example.com": "Content."})
    )
    client = FakeGeminiClient("# Title\n\nBody.")

    result = synthesize_research(conn, client, TEST_USER_ID, "topic", ["https://a.example.com"])

    assert "## Sources" in result.content
    assert "https://a.example.com" in result.content


def test_synthesize_research_tolerates_a_partial_fetch_failure(conn, monkeypatch):
    monkeypatch.setattr(
        research_module, "fetch_url_text", _fake_fetch({"https://a.example.com": "Content."})
    )
    client = FakeGeminiClient("# Title\n\nBody.")

    result = synthesize_research(
        conn, client, TEST_USER_ID, "topic", ["https://a.example.com", "https://unreachable.example.com"]
    )

    outcomes = {s.url: s.fetched for s in result.sources}
    assert outcomes["https://a.example.com"] is True
    assert outcomes["https://unreachable.example.com"] is False
    assert "couldn't fetch" in result.content  # noted in the Sources section


def test_synthesize_research_raises_when_every_source_fails(conn, monkeypatch):
    monkeypatch.setattr(research_module, "fetch_url_text", _fake_fetch({}))
    client = FakeGeminiClient("should not be used")

    with pytest.raises(NoSourcesFetchedError):
        synthesize_research(conn, client, TEST_USER_ID, "topic", ["https://unreachable.example.com"])

    assert client.calls == []  # never asked the model to synthesize nothing


def test_synthesize_research_caps_the_number_of_sources_fetched(conn, monkeypatch):
    urls = [f"https://example.com/{i}" for i in range(10)]
    fetch_calls = []

    def fetch(url):
        fetch_calls.append(url)
        return "text"

    monkeypatch.setattr(research_module, "fetch_url_text", fetch)
    client = FakeGeminiClient("# Title\n\nBody.")

    synthesize_research(conn, client, TEST_USER_ID, "topic", urls)

    assert len(fetch_calls) == research_module.MAX_SOURCES


def test_synthesize_research_logs_agent_action(conn, monkeypatch):
    monkeypatch.setattr(
        research_module, "fetch_url_text", _fake_fetch({"https://a.example.com": "Content."})
    )
    client = FakeGeminiClient("# Title\n\nBody.")

    result = synthesize_research(conn, client, TEST_USER_ID, "topic", ["https://a.example.com"])

    with conn.cursor() as cur:
        cur.execute(
            "select agent_name, action_kind, target_type, target_id from agent_actions where user_id = %s",
            (TEST_USER_ID,),
        )
        action = cur.fetchone()
    assert action == ("research", "created", "note", result.note_id)
