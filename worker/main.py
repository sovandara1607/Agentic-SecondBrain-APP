import os
import time
import uuid

import psycopg

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


def handle_job(job: dict) -> None:
    # Phase 1+ registers real handlers per job_type (process_capture,
    # run_scheduler, missed_task_pass, daily_review, weekly_review).
    # Until then, any job type is logged and considered handled, which
    # is enough to prove the claim/mark_done loop works end to end.
    print(f"worker: handled job {job['id']} ({job['job_type']})")


def mark_done(conn: psycopg.Connection, job_id: uuid.UUID) -> None:
    with conn.cursor() as cur:
        cur.execute("update jobs set status = 'done' where id = %s", (job_id,))
    conn.commit()


def run_forever() -> None:
    with psycopg.connect(DATABASE_URL) as conn:
        print("worker: started, polling for jobs")
        while True:
            job = claim_next_job(conn)
            if job is None:
                time.sleep(POLL_INTERVAL_SECONDS)
                continue
            handle_job(job)
            mark_done(conn, job["id"])


if __name__ == "__main__":
    run_forever()
