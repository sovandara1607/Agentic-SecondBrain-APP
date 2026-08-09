import os
import time
import uuid

import psycopg
from ai_core.pipeline import process_capture

DATABASE_URL = os.environ["DATABASE_URL"]
POLL_INTERVAL_SECONDS = float(os.environ.get("WORKER_POLL_INTERVAL_SECONDS", "2"))


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
    # Phase 3 registers handlers for run_scheduler, missed_task_pass,
    # daily_review, weekly_review. Any job_type without a handler here is
    # logged and considered handled (not failed) - a job type Phase 1
    # doesn't know about yet isn't this job's fault.
    if job["job_type"] == "process_capture":
        capture_id = job["payload"]["capture_id"]
        process_capture(conn, uuid.UUID(capture_id))
        print(f"worker: processed capture {capture_id} (job {job['id']})")
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


def run_forever() -> None:
    with psycopg.connect(DATABASE_URL) as conn:
        print("worker: started, polling for jobs")
        while True:
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
