import os
import time
import uuid
from datetime import date, datetime, timedelta, timezone

import psycopg
from ai_core.agents.workflow import run_workflow_check
from ai_core.client import get_client
from ai_core.email import DigestContent, send_digest, smtp_configured
from ai_core.pipeline import process_capture
from ai_core.scheduler import run_missed_task_pass, run_scheduler

DATABASE_URL = os.environ["DATABASE_URL"]
POLL_INTERVAL_SECONDS = float(os.environ.get("WORKER_POLL_INTERVAL_SECONDS", "2"))
MISSED_TASK_PASS_INTERVAL_SECONDS = float(
    os.environ.get("MISSED_TASK_PASS_INTERVAL_SECONDS", str(60 * 60))
)
# Section 17's V2 roadmap item: "Workflow Agent autonomous triggers ...
# v2 automates the trigger (scheduled monitoring) once its suggestions
# have a track record the user trusts." run_workflow_check itself stays
# schedule-agnostic (still callable on demand from POST /agents/workflow
# /check too) - this interval just adds a periodic sweep on top, same
# shape as the missed-task pass below. Defaults to every 6 hours: often
# enough to catch a project going stale without flooding agent_actions
# (run_workflow_check's own 24h recheck-window dedup caps it further).
WORKFLOW_CHECK_PASS_INTERVAL_SECONDS = float(
    os.environ.get("WORKFLOW_CHECK_PASS_INTERVAL_SECONDS", str(6 * 60 * 60))
)
# Product gap: "nothing brings you back" - a finished daily review or a
# new Workflow agent proposal previously just sat there until the user
# happened to reopen the app. No-ops entirely until real SMTP_HOST/
# SMTP_USER/SMTP_PASS are set (ai_core.email.smtp_configured) - a
# deploy without mail configured is a supported, ordinary state, not a
# missing feature that needs disabling.
DIGEST_PASS_INTERVAL_SECONDS = float(os.environ.get("DIGEST_PASS_INTERVAL_SECONDS", str(24 * 60 * 60)))
APP_URL = os.environ.get("APP_URL", "http://localhost:3000")


def claim_next_job(conn: psycopg.Connection) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            select id, user_id, job_type, payload
            from jobs
            where status = 'queued' and run_at <= now()
            order by run_at
            for update skip locked
            limit 1
            """
        )
        row = cur.fetchone()
        if row is None:
            conn.commit()
            return None
        job_id, user_id, job_type, payload = row
        cur.execute(
            "update jobs set status = 'running', attempts = attempts + 1 where id = %s",
            (job_id,),
        )
    conn.commit()
    return {"id": job_id, "user_id": user_id, "job_type": job_type, "payload": payload}


def handle_job(conn: psycopg.Connection, job: dict) -> None:
    # Phase 3 still registers daily_review/weekly_review. Any job_type
    # without a handler here is logged and considered handled (not
    # failed) - a job type this worker doesn't know about yet isn't this
    # job's fault.
    if job["job_type"] == "process_capture":
        capture_id = job["payload"]["capture_id"]
        process_capture(conn, uuid.UUID(capture_id))
        print(f"worker: processed capture {capture_id} (job {job['id']})")
    elif job["job_type"] == "run_scheduler":
        result = run_scheduler(conn, job["user_id"])
        print(
            f"worker: ran scheduler for user {job['user_id']} (job {job['id']}) - "
            f"placed {len(result.placed)}, at_risk {len(result.at_risk)}"
        )
    else:
        print(f"worker: handled job {job['id']} ({job['job_type']})")


def mark_job_status(conn: psycopg.Connection, job_id: uuid.UUID, status: str) -> None:
    with conn.cursor() as cur:
        cur.execute("update jobs set status = %s where id = %s", (status, job_id))
    conn.commit()


def mark_capture_failed(conn: psycopg.Connection, capture_id: str, error: str) -> None:
    conn.rollback()  # discard whatever the failed pipeline run left uncommitted
    with conn.cursor() as cur:
        cur.execute(
            "update captures set status = 'failed', pipeline_error = %s where id = %s",
            (error, capture_id),
        )
    conn.commit()


def run_workflow_check_pass(conn: psycopg.Connection, client=None) -> None:
    """Global sweep across all users with at least one active project -
    same "simpler than per-user dispatch, no less correct" reasoning
    run_missed_task_pass uses, since this is a monitoring pass, not a
    placement decision that needs a user's profile. Each user's check
    runs in its own try/except so one user's failure (a bad Gemini
    response, a transient DB error) can't skip the rest of the sweep.

    `client` defaults to None so the real Gemini client is only ever
    constructed (and GEMINI_API_KEY only ever required) when there's an
    active project to check - matching process_capture's existing
    lazy `client = client or get_client()` pattern instead of requiring
    the key just to start the worker, even on a deploy that never
    touches capture processing or workflow checks."""
    with conn.cursor() as cur:
        cur.execute("select distinct user_id from projects where status = 'active'")
        user_ids = [row[0] for row in cur.fetchall()]

    if not user_ids:
        return

    client = client or get_client()
    for user_id in user_ids:
        try:
            result = run_workflow_check(conn, client, user_id)
            if result.proposals:
                print(
                    f"worker: workflow check for user {user_id} flagged "
                    f"{result.projects_flagged}/{result.projects_checked} project(s), "
                    f"{len(result.proposals)} new proposal(s)"
                )
        except Exception as exc:  # noqa: BLE001 - one user's failure must not skip the rest
            print(f"worker: workflow check failed for user {user_id}: {exc}")
            conn.rollback()


def run_daily_digest_pass(conn: psycopg.Connection) -> None:
    """Global sweep across every user with an email on file - same
    "global sweep, simpler than per-user dispatch" reasoning as the
    other passes here. Each user's gather-and-send runs in its own
    try/except so one bad address or a transient SMTP failure can't
    skip the rest of the sweep. An empty digest (nothing overdue, no
    new proposals, no review ready) is never sent - a "quiet day!"
    email nobody asked for is worse than no email."""
    if not smtp_configured():
        return

    today = date.today()
    lookback = timedelta(seconds=DIGEST_PASS_INTERVAL_SECONDS)

    with conn.cursor() as cur:
        cur.execute("select id, email from auth.users where email is not null")
        users = cur.fetchall()

    for user_id, email in users:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    select title from tasks
                    where user_id = %s and status not in ('done', 'canceled')
                      and deadline is not null and deadline < now()
                    order by deadline
                    """,
                    (user_id,),
                )
                overdue = [row[0] for row in cur.fetchall()]

                # "New" proposals approximated as "created within one
                # digest interval" - there's no persisted last-sent
                # marker (a worker restart would lose it anyway, same
                # tradeoff the other interval-based passes already
                # accept), so this is a window, not a true since-last-
                # digest diff. Good enough not to re-report a month-old
                # proposal forever.
                cur.execute(
                    """
                    select summary from agent_actions
                    where user_id = %s and agent_name = 'workflow' and status = 'proposed'
                      and created_at > now() - %s::interval
                    order by created_at desc
                    """,
                    (user_id, lookback),
                )
                proposals = [row[0] for row in cur.fetchall()]

                cur.execute(
                    "select tomorrow_priorities from daily_reviews where user_id = %s and review_date = %s",
                    (user_id, today),
                )
                review_row = cur.fetchone()

            content = DigestContent(
                overdue_task_titles=overdue,
                new_workflow_proposals=proposals,
                daily_review_ready=review_row is not None,
                daily_review_priorities=(review_row[0] if review_row else []) or [],
            )
            if not content.has_content:
                continue

            send_digest(email, content, APP_URL)
            print(f"worker: sent daily digest to user {user_id}")
        except Exception as exc:  # noqa: BLE001 - one user's failure must not skip the rest
            print(f"worker: daily digest failed for user {user_id}: {exc}")
            conn.rollback()


def run_forever() -> None:
    with psycopg.connect(DATABASE_URL) as conn:
        print("worker: started, polling for jobs")
        last_missed_task_pass = 0.0
        last_workflow_check_pass = 0.0
        last_digest_pass = 0.0
        while True:
            now = time.monotonic()
            if now - last_missed_task_pass >= MISSED_TASK_PASS_INTERVAL_SECONDS:
                try:
                    result = run_missed_task_pass(conn)
                    if result.released:
                        print(
                            f"worker: missed-task pass released {len(result.released)} task(s) "
                            f"at {datetime.now(timezone.utc).isoformat()}"
                        )
                except Exception as exc:  # noqa: BLE001 - must not crash the poll loop
                    print(f"worker: missed-task pass failed: {exc}")
                    conn.rollback()
                last_missed_task_pass = now

            if now - last_workflow_check_pass >= WORKFLOW_CHECK_PASS_INTERVAL_SECONDS:
                try:
                    run_workflow_check_pass(conn)
                except Exception as exc:  # noqa: BLE001 - must not crash the poll loop
                    print(f"worker: workflow check pass failed: {exc}")
                    conn.rollback()
                last_workflow_check_pass = now

            if now - last_digest_pass >= DIGEST_PASS_INTERVAL_SECONDS:
                try:
                    run_daily_digest_pass(conn)
                except Exception as exc:  # noqa: BLE001 - must not crash the poll loop
                    print(f"worker: daily digest pass failed: {exc}")
                    conn.rollback()
                last_digest_pass = now

            job = claim_next_job(conn)
            if job is None:
                time.sleep(POLL_INTERVAL_SECONDS)
                continue
            try:
                handle_job(conn, job)
                mark_job_status(conn, job["id"], "done")
            except Exception as exc:  # noqa: BLE001 - must not crash the poll loop
                print(f"worker: job {job['id']} ({job['job_type']}) failed: {exc}")
                if job["job_type"] == "process_capture":
                    mark_capture_failed(conn, job["payload"]["capture_id"], str(exc))
                else:
                    conn.rollback()
                mark_job_status(conn, job["id"], "failed")


if __name__ == "__main__":
    run_forever()
