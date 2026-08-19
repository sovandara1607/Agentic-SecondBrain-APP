import json
import logging
import uuid
from datetime import date, timedelta

import psycopg
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ai_core.agents.memory import query_memory_stream
from ai_core.agents.planner import CycleDetectedError, ProjectNotFoundError, decompose_project
from ai_core.agents.research import NoSourcesFetchedError, synthesize_research
from ai_core.agents.review import (
    generate_daily_review,
    generate_monthly_review,
    generate_weekly_review,
)
from ai_core.agents.workflow import run_workflow_check
from ai_core.agents.writer import NoteNotFoundError, draft_document
from ai_core.client import get_client
from core.auth import verify_jwt
from core.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agents")


class MemoryStreamRequest(BaseModel):
    query: str
    conversation_id: str | None = None
    language: str = "en"  # apps/web's EN/KH switcher - see ai_core/i18n.py


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


@router.post("/memory/stream")
def memory_stream(
    body: MemoryStreamRequest, user_id: str = Depends(verify_jwt)
) -> StreamingResponse:
    # Ownership check happens outside the generator, before any bytes are
    # sent - StreamingResponse commits to its status code as soon as
    # streaming starts, so raising HTTPException from inside the generator
    # can't turn into a clean 404 once that's underway.
    if body.conversation_id:
        with psycopg.connect(get_settings().database_url) as check_conn:
            with check_conn.cursor() as cur:
                cur.execute(
                    "select 1 from conversations where id = %s and user_id = %s",
                    (body.conversation_id, user_id),
                )
                if cur.fetchone() is None:
                    raise HTTPException(status_code=404, detail="conversation not found")

    def generate():
        conn = None
        # Seeded before the try block so the except handler always has a
        # value to log, even if the failure happens before a new
        # conversation id is assigned.
        conversation_id = body.conversation_id
        try:
            conn = psycopg.connect(get_settings().database_url)
            with conn.cursor() as cur:
                if body.conversation_id:
                    conversation_id = body.conversation_id
                else:
                    cur.execute(
                        "insert into conversations (user_id, title) values (%s, %s) returning id",
                        (user_id, body.query[:80]),
                    )
                    conversation_id = str(cur.fetchone()[0])
                    conn.commit()
                yield _sse({"type": "conversation", "id": conversation_id})

                # user_id filters below are defense-in-depth on top of the
                # ownership check above - conversation_id was already
                # verified to belong to this user (or was just created for
                # them), but keeping the filter here means a future caller
                # of this query can't reintroduce the IDOR by trusting
                # conversation_id alone.
                cur.execute(
                    """
                    select role, content from messages
                    where conversation_id = %s and user_id = %s
                    order by created_at
                    """,
                    (conversation_id, user_id),
                )
                history = [{"role": role, "content": content} for role, content in cur.fetchall()]

                cur.execute(
                    "insert into messages (conversation_id, user_id, role, content) values (%s, %s, 'user', %s)",
                    (conversation_id, user_id, body.query),
                )
                conn.commit()

            client = get_client()
            tokens, citations = query_memory_stream(
                conn, client, uuid.UUID(user_id), body.query, history, body.language
            )

            full_response = []
            for token in tokens:
                full_response.append(token)
                yield _sse({"type": "token", "text": token})

            citation_payload = [
                {
                    "content_type": c.content_type,
                    "content_id": str(c.content_id),
                    "title": c.title,
                }
                for c in citations
            ]
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into messages (conversation_id, user_id, role, content, citations)
                    values (%s, %s, 'assistant', %s, %s)
                    """,
                    (conversation_id, user_id, "".join(full_response), json.dumps(citation_payload)),
                )
            conn.commit()

            yield _sse({"type": "citations", "citations": citation_payload})
            yield _sse({"type": "done"})
        except Exception:  # noqa: BLE001 - surface to the client, don't 500 mid-stream
            conn.rollback()
            # Log the real exception server-side only - str(exc) can carry
            # internals (a psycopg connection failure embeds the DSN,
            # password included) that must never reach the client.
            logger.exception("memory_stream failed for conversation %s", conversation_id)
            yield _sse(
                {"type": "error", "message": "Something went wrong answering that. Try again."}
            )
        finally:
            if conn:
                conn.close()

    return StreamingResponse(generate(), media_type="text/event-stream")


class PlannerDecomposeRequest(BaseModel):
    project_id: str
    goal: str
    language: str = "en"


@router.post("/planner/decompose")
def planner_decompose(body: PlannerDecomposeRequest, user_id: str = Depends(verify_jwt)) -> dict:
    try:
        project_uuid = uuid.UUID(body.project_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid project_id")

    conn = None
    try:
        conn = psycopg.connect(get_settings().database_url)
        client = get_client()
        result = decompose_project(conn, client, user_id, project_uuid, body.goal, body.language)
    except ProjectNotFoundError:
        raise HTTPException(status_code=404, detail="project not found")
    except CycleDetectedError as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:  # noqa: BLE001 - never leak exception internals to the client
        conn.rollback()
        logger.exception("planner_decompose failed for project %s", project_uuid)
        raise HTTPException(
            status_code=500, detail="Something went wrong decomposing that goal. Try again."
        )
    finally:
        if conn:
            conn.close()

    return {
        "project_id": str(result.project_id),
        "total_tasks": result.total_tasks,
        "groups": [
            {"name": g.name, "task_ids": [str(t) for t in g.task_ids]} for g in result.groups
        ],
    }


class DailyReviewRequest(BaseModel):
    review_date: str | None = None  # ISO date (YYYY-MM-DD), defaults to today
    language: str = "en"


@router.post("/review/daily")
def review_daily(body: DailyReviewRequest, user_id: str = Depends(verify_jwt)) -> dict:
    if body.review_date:
        try:
            target_date = date.fromisoformat(body.review_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="invalid review_date")
    else:
        target_date = date.today()

    conn = None
    try:
        conn = psycopg.connect(get_settings().database_url)
        client = get_client()
        result = generate_daily_review(conn, client, user_id, target_date, body.language)
    except Exception:  # noqa: BLE001 - never leak exception internals to the client
        if conn:
            conn.rollback()
        logger.exception("review_daily failed for user %s on %s", user_id, target_date)
        raise HTTPException(
            status_code=500, detail="Something went wrong generating today's review. Try again."
        )
    finally:
        if conn:
            conn.close()

    return {
        "id": str(result.id),
        "review_date": result.review_date.isoformat(),
        "completed_tasks": result.completed_tasks,
        "unfinished_tasks": result.unfinished_tasks,
        "new_knowledge": result.new_knowledge,
        "decisions": result.decisions,
        "blockers": result.blockers,
        "tomorrow_priorities": result.tomorrow_priorities,
    }


class WeeklyReviewRequest(BaseModel):
    week_start: str | None = None  # ISO date (YYYY-MM-DD), the Monday to start from - defaults
    # to the current week's Monday
    language: str = "en"


@router.post("/review/weekly")
def review_weekly(body: WeeklyReviewRequest, user_id: str = Depends(verify_jwt)) -> dict:
    if body.week_start:
        try:
            target_week_start = date.fromisoformat(body.week_start)
        except ValueError:
            raise HTTPException(status_code=400, detail="invalid week_start")
    else:
        today = date.today()
        target_week_start = today - timedelta(days=today.weekday())

    conn = None
    try:
        conn = psycopg.connect(get_settings().database_url)
        client = get_client()
        result = generate_weekly_review(conn, client, user_id, target_week_start, body.language)
    except Exception:  # noqa: BLE001 - never leak exception internals to the client
        if conn:
            conn.rollback()
        logger.exception("review_weekly failed for user %s week of %s", user_id, target_week_start)
        raise HTTPException(
            status_code=500, detail="Something went wrong generating this week's review. Try again."
        )
    finally:
        if conn:
            conn.close()

    return {
        "id": str(result.id),
        "week_start": result.week_start.isoformat(),
        "project_progress": result.project_progress,
        "knowledge_learned": result.knowledge_learned,
        "time_allocation": result.time_allocation,
        "missed_deadlines": result.missed_deadlines,
        "recommendations": result.recommendations,
    }


class MonthlyReviewRequest(BaseModel):
    month_start: str | None = None  # ISO date (YYYY-MM-DD), any day in the target month -
    # normalized to the 1st. Defaults to the current month.
    language: str = "en"


@router.post("/review/monthly")
def review_monthly(body: MonthlyReviewRequest, user_id: str = Depends(verify_jwt)) -> dict:
    if body.month_start:
        try:
            given = date.fromisoformat(body.month_start)
        except ValueError:
            raise HTTPException(status_code=400, detail="invalid month_start")
    else:
        given = date.today()
    target_month_start = given.replace(day=1)

    conn = None
    try:
        conn = psycopg.connect(get_settings().database_url)
        client = get_client()
        result = generate_monthly_review(conn, client, user_id, target_month_start, body.language)
    except Exception:  # noqa: BLE001 - never leak exception internals to the client
        if conn:
            conn.rollback()
        logger.exception("review_monthly failed for user %s month of %s", user_id, target_month_start)
        raise HTTPException(
            status_code=500, detail="Something went wrong generating this month's review. Try again."
        )
    finally:
        if conn:
            conn.close()

    return {
        "id": str(result.id),
        "month_start": result.month_start.isoformat(),
        "weeks_included": result.weeks_included,
        "project_progress": result.project_progress,
        "knowledge_learned_count": result.knowledge_learned_count,
        "time_allocation": result.time_allocation,
        "missed_deadlines_count": result.missed_deadlines_count,
        "recommendations": result.recommendations,
    }


class WriterDraftRequest(BaseModel):
    prompt: str
    doc_type: str = "document"  # email | report | presentation_outline | document
    existing_note_id: str | None = None  # set to refine an existing draft instead of creating one
    language: str = "en"


@router.post("/writer/draft")
def writer_draft(body: WriterDraftRequest, user_id: str = Depends(verify_jwt)) -> dict:
    existing_note_uuid = None
    if body.existing_note_id:
        try:
            existing_note_uuid = uuid.UUID(body.existing_note_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="invalid existing_note_id")

    conn = None
    try:
        conn = psycopg.connect(get_settings().database_url)
        client = get_client()
        result = draft_document(
            conn, client, user_id, body.prompt, body.doc_type, existing_note_uuid, body.language
        )
    except NoteNotFoundError:
        raise HTTPException(status_code=404, detail="note not found")
    except Exception:  # noqa: BLE001 - never leak exception internals to the client
        if conn:
            conn.rollback()
        logger.exception("writer_draft failed for user %s", user_id)
        raise HTTPException(
            status_code=500, detail="Something went wrong drafting that. Try again."
        )
    finally:
        if conn:
            conn.close()

    return {
        "note_id": str(result.note_id),
        "title": result.title,
        "content": result.content,
        "doc_type": result.doc_type,
        "action": result.action,
    }


class WorkflowCheckRequest(BaseModel):
    language: str = "en"


@router.post("/workflow/check")
def workflow_check(
    body: WorkflowCheckRequest = WorkflowCheckRequest(), user_id: str = Depends(verify_jwt)
) -> dict:
    conn = None
    try:
        conn = psycopg.connect(get_settings().database_url)
        client = get_client()
        result = run_workflow_check(conn, client, user_id, body.language)
    except Exception:  # noqa: BLE001 - never leak exception internals to the client
        if conn:
            conn.rollback()
        logger.exception("workflow_check failed for user %s", user_id)
        raise HTTPException(
            status_code=500, detail="Something went wrong checking your projects. Try again."
        )
    finally:
        if conn:
            conn.close()

    return {
        "projects_checked": result.projects_checked,
        "projects_flagged": result.projects_flagged,
        "proposals": [
            {
                "id": str(p.id),
                "project_id": str(p.project_id),
                "project_name": p.project_name,
                "issue": p.issue,
                "proposed_action": p.proposed_action,
            }
            for p in result.proposals
        ],
    }


class ResearchSynthesizeRequest(BaseModel):
    topic: str
    urls: list[str]
    language: str = "en"


@router.post("/research/synthesize")
def research_synthesize(body: ResearchSynthesizeRequest, user_id: str = Depends(verify_jwt)) -> dict:
    if not body.urls:
        raise HTTPException(status_code=400, detail="at least one url is required")

    conn = None
    try:
        conn = psycopg.connect(get_settings().database_url)
        client = get_client()
        result = synthesize_research(conn, client, user_id, body.topic, body.urls, body.language)
    except NoSourcesFetchedError:
        raise HTTPException(status_code=422, detail="None of the given URLs could be fetched")
    except Exception:  # noqa: BLE001 - never leak exception internals to the client
        if conn:
            conn.rollback()
        logger.exception("research_synthesize failed for user %s", user_id)
        raise HTTPException(
            status_code=500, detail="Something went wrong researching that. Try again."
        )
    finally:
        if conn:
            conn.close()

    return {
        "note_id": str(result.note_id),
        "title": result.title,
        "content": result.content,
        "sources": [{"url": s.url, "fetched": s.fetched, "error": s.error} for s in result.sources],
    }
