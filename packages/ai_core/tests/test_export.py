import os
import zipfile
from io import BytesIO

import psycopg
import pytest

from ai_core.export import build_export_zip

DATABASE_URL = os.environ["DATABASE_URL"]
TEST_USER_ID = "20202020-2020-2020-2020-202020202020"
OTHER_USER_ID = "21212121-2121-2121-2121-212121212121"


@pytest.fixture
def conn():
    with psycopg.connect(DATABASE_URL, autocommit=False) as connection:
        with connection.cursor() as cur:
            cur.execute(
                """
                insert into auth.users (id, email, encrypted_password)
                values (%s, 'phase-export-test@example.com', 'x')
                on conflict (id) do nothing
                """,
                (TEST_USER_ID,),
            )
        connection.commit()
        yield connection
        with connection.cursor() as cur:
            cur.execute("delete from auth.users where id = %s", (TEST_USER_ID,))
        connection.commit()


def _zip_names(zip_bytes: bytes) -> list[str]:
    with zipfile.ZipFile(BytesIO(zip_bytes)) as zf:
        return zf.namelist()


def _zip_read(zip_bytes: bytes, name: str) -> str:
    with zipfile.ZipFile(BytesIO(zip_bytes)) as zf:
        return zf.read(name).decode("utf-8")


def test_build_export_zip_includes_a_readme(conn):
    zip_bytes = build_export_zip(conn, TEST_USER_ID)
    assert "README.md" in _zip_names(zip_bytes)


def test_build_export_zip_exports_a_project(conn):
    with conn.cursor() as cur:
        cur.execute(
            "insert into projects (user_id, name, overview, status) values (%s, %s, %s, 'active') returning id",
            (TEST_USER_ID, "MyLMS", "A learning platform."),
        )
    conn.commit()

    zip_bytes = build_export_zip(conn, TEST_USER_ID)

    assert "Projects/MyLMS.md" in _zip_names(zip_bytes)
    content = _zip_read(zip_bytes, "Projects/MyLMS.md")
    assert "status: active" in content
    assert "# MyLMS" in content
    assert "A learning platform." in content


def test_build_export_zip_exports_a_note_with_frontmatter_and_tags(conn):
    with conn.cursor() as cur:
        cur.execute(
            "insert into notes (user_id, title, content, note_type) values (%s, %s, %s, 'note') returning id",
            (TEST_USER_ID, "Redis vs Postgres", "Some **markdown** content with a [[Linked Note]]."),
        )
        note_id = cur.fetchone()[0]
        cur.execute(
            "insert into tags (user_id, name) values (%s, 'infra') returning id", (TEST_USER_ID,)
        )
        tag_id = cur.fetchone()[0]
        cur.execute(
            "insert into taggables (tag_id, taggable_type, taggable_id) values (%s, 'note', %s)",
            (tag_id, note_id),
        )
    conn.commit()

    zip_bytes = build_export_zip(conn, TEST_USER_ID)

    assert "Notes/Redis vs Postgres.md" in _zip_names(zip_bytes)
    content = _zip_read(zip_bytes, "Notes/Redis vs Postgres.md")
    assert "type: note" in content
    assert "- infra" in content
    assert "Some **markdown** content with a [[Linked Note]]." in content


def test_build_export_zip_links_a_note_to_its_project_by_name(conn):
    with conn.cursor() as cur:
        cur.execute(
            "insert into projects (user_id, name) values (%s, 'MyLMS') returning id", (TEST_USER_ID,)
        )
        project_id = cur.fetchone()[0]
        cur.execute(
            "insert into notes (user_id, title, content, project_id) values (%s, 'A note', 'body', %s)",
            (TEST_USER_ID, project_id),
        )
    conn.commit()

    zip_bytes = build_export_zip(conn, TEST_USER_ID)

    content = _zip_read(zip_bytes, "Notes/A note.md")
    assert "project: MyLMS" in content


def test_build_export_zip_exports_a_task(conn):
    with conn.cursor() as cur:
        cur.execute(
            "insert into tasks (user_id, title, context, status, priority) values (%s, 'Ship it', 'context text', 'open', 1)",
            (TEST_USER_ID,),
        )
    conn.commit()

    zip_bytes = build_export_zip(conn, TEST_USER_ID)

    assert "Tasks/Ship it.md" in _zip_names(zip_bytes)
    content = _zip_read(zip_bytes, "Tasks/Ship it.md")
    assert "status: open" in content
    assert "priority: 1" in content
    assert "context text" in content


def test_build_export_zip_deduplicates_same_titled_notes(conn):
    with conn.cursor() as cur:
        cur.execute(
            "insert into notes (user_id, title, content) values (%s, 'Duplicate', 'first')",
            (TEST_USER_ID,),
        )
        cur.execute(
            "insert into notes (user_id, title, content) values (%s, 'Duplicate', 'second')",
            (TEST_USER_ID,),
        )
    conn.commit()

    zip_bytes = build_export_zip(conn, TEST_USER_ID)
    names = _zip_names(zip_bytes)

    assert "Notes/Duplicate.md" in names
    assert "Notes/Duplicate (2).md" in names


def test_build_export_zip_sanitizes_illegal_filename_characters(conn):
    with conn.cursor() as cur:
        cur.execute(
            "insert into notes (user_id, title, content) values (%s, %s, 'body')",
            (TEST_USER_ID, "Q3/Q4: Plan?"),
        )
    conn.commit()

    zip_bytes = build_export_zip(conn, TEST_USER_ID)
    names = _zip_names(zip_bytes)

    assert any(n.startswith("Notes/Q3Q4 Plan.md") for n in names)


def test_build_export_zip_scopes_to_the_requesting_user(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into auth.users (id, email, encrypted_password)
            values (%s, 'phase-export-other-test@example.com', 'x')
            on conflict (id) do nothing
            """,
            (OTHER_USER_ID,),
        )
        cur.execute(
            "insert into notes (user_id, title, content) values (%s, 'Not yours', 'secret')",
            (OTHER_USER_ID,),
        )
    conn.commit()

    try:
        zip_bytes = build_export_zip(conn, TEST_USER_ID)
        assert "Notes/Not yours.md" not in _zip_names(zip_bytes)
    finally:
        with conn.cursor() as cur:
            cur.execute("delete from auth.users where id = %s", (OTHER_USER_ID,))
        conn.commit()
