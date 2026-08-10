import json
import uuid

import psycopg
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from openai import OpenAI
from pydantic import BaseModel

from ai_core.agents.memory import query_memory_stream
from core.auth import verify_jwt
from core.config import get_settings

router = APIRouter(prefix="/agents")


class MemoryStreamRequest(BaseModel):
    query: str
    conversation_id: str | None = None


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
        conn = psycopg.connect(get_settings().database_url)
        try:
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

            client = OpenAI()
            tokens, citations = query_memory_stream(
                conn, client, uuid.UUID(user_id), body.query, history
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
        except Exception as exc:  # noqa: BLE001 - surface to the client, don't 500 mid-stream
            conn.rollback()
            yield _sse({"type": "error", "message": str(exc)})
        finally:
            conn.close()

    return StreamingResponse(generate(), media_type="text/event-stream")
