"""Data export (V2 roadmap, Section 17): "Obsidian-style local markdown
export/import, for users who want portability guarantees." Import is left
for a later pass - export is what "portability guarantees" is actually
about (proving the data isn't locked in), not full bidirectional sync.

One .md file per note/task/project, each with YAML frontmatter. Notes
already use `[[Title]]` wikilinks as their backlink convention
(apps/web/app/(app)/notes/actions.ts's WIKILINK_PATTERN, and content is
already stored as real markdown there via turndown on save - not HTML),
so filenames are the note's exact title, letting Obsidian's own
title-based link resolution work on the export with zero rewriting.
Collisions (two notes with the same title) get a Windows/Obsidian-style
" (2)", " (3)", ... suffix, same convention Obsidian itself uses.
"""

from __future__ import annotations

import io
import re
import uuid
import zipfile
from datetime import date, datetime

import psycopg

_ILLEGAL_FILENAME_CHARS = re.compile(r'[\\/:*?"<>|]')


def _safe_filename(title: str, used: set[str]) -> str:
    base = _ILLEGAL_FILENAME_CHARS.sub("", title).strip() or "Untitled"
    base = base[:150]  # filesystem-safe length, generous for a note title
    candidate = base
    n = 2
    while candidate.lower() in used:
        candidate = f"{base} ({n})"
        n += 1
    used.add(candidate.lower())
    return candidate


def _yaml_scalar(value) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    s = str(value)
    # Quote anything that would otherwise be ambiguous or break YAML's
    # simple scalar syntax - colons, brackets, leading/trailing
    # whitespace, or an empty string.
    if s == "" or s != s.strip() or re.search(r'[:#\[\]{}]', s):
        return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return s


def _frontmatter(fields: dict) -> str:
    lines = ["---"]
    for key, value in fields.items():
        if isinstance(value, list):
            if not value:
                lines.append(f"{key}: []")
            else:
                lines.append(f"{key}:")
                lines.extend(f"  - {_yaml_scalar(item)}" for item in value)
        else:
            lines.append(f"{key}: {_yaml_scalar(value)}")
    lines.append("---")
    return "\n".join(lines)


def _fetch_projects(cur, user_id: uuid.UUID):
    cur.execute(
        """
        select id, name, overview, goals, status, progress, start_date, target_date
        from projects where user_id = %s order by name
        """,
        (user_id,),
    )
    return cur.fetchall()


def _fetch_notes(cur, user_id: uuid.UUID):
    cur.execute(
        """
        select id, title, content, note_type, project_id, created_at, updated_at
        from notes where user_id = %s order by created_at
        """,
        (user_id,),
    )
    return cur.fetchall()


def _fetch_tasks(cur, user_id: uuid.UUID):
    cur.execute(
        """
        select id, title, context, status, priority, energy_level, deadline, project_id
        from tasks where user_id = %s order by created_at
        """,
        (user_id,),
    )
    return cur.fetchall()


def _fetch_note_tags(cur, user_id: uuid.UUID) -> dict[uuid.UUID, list[str]]:
    cur.execute(
        """
        select tb.taggable_id, tg.name
        from taggables tb
        join tags tg on tg.id = tb.tag_id
        where tg.user_id = %s and tb.taggable_type = 'note'
        order by tg.name
        """,
        (user_id,),
    )
    by_note: dict[uuid.UUID, list[str]] = {}
    for note_id, tag_name in cur.fetchall():
        by_note.setdefault(note_id, []).append(tag_name)
    return by_note


def build_export_zip(conn: psycopg.Connection, user_id: uuid.UUID) -> bytes:
    with conn.cursor() as cur:
        projects = _fetch_projects(cur, user_id)
        notes = _fetch_notes(cur, user_id)
        tasks = _fetch_tasks(cur, user_id)
        tags_by_note = _fetch_note_tags(cur, user_id)

    project_names = {pid: name for pid, name, *_ in projects}
    used_names = {"Projects": set(), "Notes": set(), "Tasks": set()}

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for pid, name, overview, goals, status, progress, start_date, target_date in projects:
            filename = _safe_filename(name, used_names["Projects"])
            frontmatter = _frontmatter(
                {
                    "id": str(pid),
                    "status": status,
                    "progress": progress,
                    "start_date": start_date,
                    "target_date": target_date,
                }
            )
            body_parts = [f"# {name}", overview or ""]
            if goals:
                body_parts += ["## Goals", goals]
            zf.writestr(f"Projects/{filename}.md", frontmatter + "\n\n" + "\n\n".join(p for p in body_parts if p) + "\n")

        for nid, title, content, note_type, project_id, created_at, updated_at in notes:
            filename = _safe_filename(title, used_names["Notes"])
            frontmatter = _frontmatter(
                {
                    "id": str(nid),
                    "type": note_type,
                    "project": project_names.get(project_id),
                    "tags": tags_by_note.get(nid, []),
                    "created_at": created_at,
                    "updated_at": updated_at,
                }
            )
            zf.writestr(f"Notes/{filename}.md", frontmatter + "\n\n" + (content or "") + "\n")

        for tid, title, context, status, priority, energy_level, deadline, project_id in tasks:
            filename = _safe_filename(title, used_names["Tasks"])
            frontmatter = _frontmatter(
                {
                    "id": str(tid),
                    "status": status,
                    "priority": priority,
                    "energy_level": energy_level,
                    "deadline": deadline,
                    "project": project_names.get(project_id),
                }
            )
            zf.writestr(f"Tasks/{filename}.md", frontmatter + "\n\n" + (context or "") + "\n")

        readme = (
            "# Second Brain export\n\n"
            f"Exported {datetime.now().isoformat(timespec='seconds')}\n\n"
            f"- {len(projects)} project(s) in `Projects/`\n"
            f"- {len(notes)} note(s) in `Notes/`\n"
            f"- {len(tasks)} task(s) in `Tasks/`\n\n"
            "Open this folder as an Obsidian vault - `[[wikilinks]]` in notes "
            "resolve by title, same as they did in the app.\n"
        )
        zf.writestr("README.md", readme)

    return buf.getvalue()
