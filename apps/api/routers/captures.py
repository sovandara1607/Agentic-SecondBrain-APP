import json
import logging
import uuid

import psycopg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.auth import verify_jwt, verify_jwt_or_api_token
from core.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/captures")


class CreateCaptureRequest(BaseModel):
    raw_text: str | None = None
    source_url: str | None = None


@router.post("")
def create_capture(body: CreateCaptureRequest, user_id: str = Depends(verify_jwt_or_api_token)) -> dict:
    """V2 roadmap (Section 17): "Public API: for users who want to script
    their own capture sources." Accepts either a Supabase session JWT
    (the app itself could call this, though it currently writes captures
    straight to Supabase - apps/web/app/(app)/inbox/actions.ts) or a
    long-lived API token (core/auth.py's verify_jwt_or_api_token). Same
    text/url shape and the same insert-trigger job-enqueue path
    (0002_capture_processing_pipeline.sql) as every other capture.
    """
    raw_text = (body.raw_text or "").strip() or None
    source_url = (body.source_url or "").strip() or None
    if not raw_text and not source_url:
        raise HTTPException(status_code=400, detail="raw_text or source_url is required")

    conn = None
    try:
        conn = psycopg.connect(get_settings().database_url)
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into captures (user_id, kind, raw_text, source_url)
                values (%s, %s, %s, %s)
                returning id, status
                """,
                (user_id, "url" if source_url else "text", raw_text, source_url),
            )
            capture_id, status_value = cur.fetchone()
        conn.commit()
    except Exception:  # noqa: BLE001 - never leak exception internals to the client
        if conn:
            conn.rollback()
        logger.exception("create_capture failed for user %s", user_id)
        raise HTTPException(status_code=500, detail="Couldn't save that capture. Try again.")
    finally:
        if conn:
            conn.close()

    return {"id": str(capture_id), "status": status_value}


@router.post("/{capture_id}/reprocess")
def reprocess_capture(capture_id: str, user_id: str = Depends(verify_jwt)) -> dict:
    """Section 5.2: "Manually re-run the pipeline on a capture (user-
    triggered correction)". Resets the capture back to `pending` and
    enqueues a fresh `process_capture` job - the same trigger path a new
    capture goes through (0002_capture_processing_pipeline.sql's insert
    trigger), just invoked directly instead of via an insert. The worker
    picks it up the same way either time; this endpoint itself doesn't
    run the pipeline synchronously.
    """
    try:
        capture_uuid = uuid.UUID(capture_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid capture_id")

    conn = None
    try:
        conn = psycopg.connect(get_settings().database_url)
        with conn.cursor() as cur:
            # 404 for both "doesn't exist" and "belongs to someone else" -
            # same non-disclosure shape as every other agent endpoint's
            # ownership check in this codebase (e.g. planner_decompose).
            cur.execute(
                "select id from captures where id = %s and user_id = %s",
                (capture_uuid, user_id),
            )
            if cur.fetchone() is None:
                raise HTTPException(status_code=404, detail="capture not found")

            cur.execute(
                """
                update captures
                set status = 'pending', pipeline_error = null, processed_at = null
                where id = %s
                """,
                (capture_uuid,),
            )
            cur.execute(
                "insert into jobs (user_id, job_type, payload) values (%s, 'process_capture', %s)",
                (user_id, json.dumps({"capture_id": str(capture_uuid)})),
            )
        conn.commit()
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 - never leak exception internals to the client
        if conn:
            conn.rollback()
        logger.exception("reprocess_capture failed for capture %s", capture_uuid)
        raise HTTPException(
            status_code=500, detail="Couldn't reprocess that capture. Try again."
        )
    finally:
        if conn:
            conn.close()

    return {"capture_id": str(capture_uuid), "status": "pending"}
