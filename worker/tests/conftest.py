"""Shared test setup: DB-integration tests in this suite connect straight
to Postgres via `os.environ["DATABASE_URL"]` in their own fixtures (no
mocking - see the module docstrings in each test file for why: this is
an RLS-and-schema-heavy app, a mock would test the mock, not the query).
That's the right call for local development against the real stack
(`docker compose -f infra/supabase/docker-compose.yml up`), but CI runs
on a bare runner with no Postgres yet (standing up the full self-hosted
Supabase stack - Postgres, GoTrue, Storage, Realtime - as a CI job is a
real follow-up, not done here).

This fixture makes that gap loud but non-fatal: it probes DATABASE_URL
once per session, and skips (not errors, not silently passes) every test
module that declares the `DATABASE_URL = os.environ["DATABASE_URL"]`
constant every DB-integration test module in this suite uses, when the
database isn't actually reachable - so `pytest` stays green in CI on the
pure-logic subset (JWT verification, the webfetch SSRF guard, etc.)
instead of reporting a wall of connection-refused errors that look like
real bugs. Anyone running this locally against the real stack gets full
DB-integration coverage, unaffected.
"""

import os

import psycopg
import pytest


def _database_reachable() -> bool:
    url = os.environ.get("DATABASE_URL")
    if not url:
        return False
    try:
        with psycopg.connect(url, connect_timeout=2):
            return True
    except psycopg.OperationalError:
        return False


_DB_REACHABLE = _database_reachable()


@pytest.fixture(autouse=True)
def _skip_if_db_unreachable(request):
    if _DB_REACHABLE:
        return
    if getattr(request.module, "DATABASE_URL", None) is not None:
        pytest.skip("DATABASE_URL not reachable - DB-integration test skipped")
