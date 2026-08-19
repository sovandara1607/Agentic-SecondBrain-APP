import logging

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query

from ai_core.client import get_client
from ai_core.search import hybrid_search
from core.auth import verify_jwt
from core.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/search")
def search(
    q: str = Query(..., min_length=1),
    mode: str = Query("hybrid"),
    user_id: str = Depends(verify_jwt),
) -> dict:
    if mode != "hybrid":
        raise HTTPException(status_code=400, detail="only mode=hybrid is supported")

    conn = None
    try:
        conn = psycopg.connect(get_settings().database_url)
        client = get_client()
        results = hybrid_search(conn, client, user_id, q)
    except Exception:  # noqa: BLE001 - never leak exception internals to the client
        logger.exception("search failed for user %s", user_id)
        raise HTTPException(status_code=500, detail="Search failed. Try again.")
    finally:
        if conn:
            conn.close()

    return {
        "query": q,
        "results": [
            {
                "content_type": r.content_type,
                "content_id": str(r.content_id),
                "title": r.title,
                "snippet": r.snippet,
                "score": r.score,
            }
            for r in results
        ],
    }
