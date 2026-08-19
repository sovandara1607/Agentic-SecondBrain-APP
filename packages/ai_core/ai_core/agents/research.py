"""Research agent (design doc Section 6): "fetch, chunk, compare,
synthesize". The only agent whose read set includes web fetch (Section
6: "documents, web fetch (v2)") - deferred out of the MVP (Section 17)
specifically because outbound fetch is a distinct integration surface,
now built in ai_core/webfetch.py.

Fetches each given source URL, truncates each to a bounded size (so one
huge page can't blow the prompt budget or drown out the others), asks
the model to compare and synthesize across all of them, and writes the
result as a `notes` row (note_type: 'summary' - the same convention
Writer already established for AI-authored documents) - "writes notes
(summary type)" per Section 6's agent table. A source that fails to
fetch doesn't abort the whole request; it's just noted as unavailable in
the synthesized note's Sources section, so a user can see exactly what
was and wasn't actually used.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass

from ai_core.client import CHAT_MODEL
from ai_core.i18n import language_suffix
from ai_core.webfetch import FetchError, InvalidUrlError, fetch_url_text

MAX_SOURCES = 6
PER_SOURCE_CHAR_LIMIT = 8000

_SYSTEM_PROMPT = (
    "You are the Research agent for a personal second-brain app. You're "
    "given a research topic and the fetched text of several web sources. "
    "Compare what the sources say, note where they agree or disagree, "
    "and synthesize a clear answer to the topic grounded only in what "
    "the sources actually say - don't add outside knowledge as fact. "
    "Start with a single markdown H1 title line, then organize the body "
    "with headings as appropriate."
)


class NoSourcesFetchedError(RuntimeError):
    pass


@dataclass
class SourceOutcome:
    url: str
    fetched: bool
    error: str | None = None


@dataclass
class ResearchResult:
    note_id: uuid.UUID
    title: str
    content: str
    sources: list[SourceOutcome]


def _fetch_sources(urls: list[str]) -> tuple[list[str], list[SourceOutcome]]:
    blocks: list[str] = []
    outcomes: list[SourceOutcome] = []
    for url in urls[:MAX_SOURCES]:
        try:
            text = fetch_url_text(url)
        except (InvalidUrlError, FetchError) as exc:
            outcomes.append(SourceOutcome(url=url, fetched=False, error=str(exc)))
            continue
        blocks.append(f"Source: {url}\n{text[:PER_SOURCE_CHAR_LIMIT]}")
        outcomes.append(SourceOutcome(url=url, fetched=True))
    return blocks, outcomes


def _sources_section(sources: list[SourceOutcome]) -> str:
    lines = ["", "## Sources", ""]
    for s in sources:
        lines.append(f"- {s.url}" + ("" if s.fetched else f" (couldn't fetch: {s.error})"))
    return "\n".join(lines)


def synthesize_research(
    conn,
    client,
    user_id: uuid.UUID,
    topic: str,
    urls: list[str],
    language: str = "en",
) -> ResearchResult:
    source_blocks, outcomes = _fetch_sources(urls)
    if not source_blocks:
        raise NoSourcesFetchedError("None of the given URLs could be fetched")

    combined = "\n\n---\n\n".join(source_blocks)
    response = client.chat.completions.create(
        model=CHAT_MODEL,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT + language_suffix(language)},
            {"role": "user", "content": f"Research topic: {topic}\n\nSources:\n{combined}"},
        ],
    )
    body = (response.content or "").strip()
    title = body.splitlines()[0].lstrip("# ").strip()[:120] if body else topic[:120]
    content = body + _sources_section(outcomes)

    with conn.cursor() as cur:
        cur.execute(
            """
            insert into notes (user_id, title, content, note_type)
            values (%s, %s, %s, 'summary')
            returning id
            """,
            (user_id, title, content),
        )
        note_id = cur.fetchone()[0]

        fetched_count = sum(1 for s in outcomes if s.fetched)
        cur.execute(
            """
            insert into agent_actions
                (user_id, agent_name, action_kind, target_type, target_id, summary, detail)
            values (%s, 'research', 'created', 'note', %s, %s, %s)
            """,
            (
                user_id,
                note_id,
                f"Synthesized research on \"{topic}\" from {fetched_count}/{len(outcomes)} source(s): {title}",
                json.dumps(
                    {
                        "topic": topic,
                        "sources": [
                            {"url": s.url, "fetched": s.fetched, "error": s.error} for s in outcomes
                        ],
                    }
                ),
            ),
        )

    conn.commit()
    return ResearchResult(note_id=note_id, title=title, content=content, sources=outcomes)
