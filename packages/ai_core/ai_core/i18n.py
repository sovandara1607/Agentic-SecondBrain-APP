"""Shared language instruction for agent-generated text - the web app's
EN/KH switcher (apps/web/lib/i18n) passes the user's chosen language
through so agent output matches it too, not just the app's own UI
strings, which apps/web/lib/i18n/dictionary.ts covers separately and
has nothing to do with this module.

Deliberately just an appended system-prompt instruction, not a
translation pass over deterministic values (dates, counts, task titles
pulled verbatim from the user's own data) - those stay as-is regardless
of language, matching dictionary.ts's own scope note that user data
isn't what a UI-language switch translates.
"""

from __future__ import annotations

_INSTRUCTIONS = {
    "km": (
        "\n\nRespond in Khmer (ភាសាខ្មែរ). Keep proper nouns, task/project "
        "titles, and URLs exactly as given in the context below - translate "
        "only the prose you generate around them."
    ),
}


def language_suffix(language: str | None) -> str:
    """Text to append to a system prompt for the given language code.
    Empty string for English (the default) or anything unrecognized -
    never raises on a bad/missing value, since the language choice is
    a UI preference passed through from the client, not something
    worth failing a whole agent call over if it's garbled."""
    return _INSTRUCTIONS.get((language or "en").strip().lower(), "")
