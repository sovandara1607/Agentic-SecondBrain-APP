import logging
from datetime import date

import psycopg
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from ai_core.export import build_export_zip
from core.auth import verify_jwt
from core.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/export")
def export_data(user_id: str = Depends(verify_jwt)) -> Response:
    """V2 roadmap (Section 17): "Data export and local sync: Obsidian-
    style local markdown export/import, for users who want portability
    guarantees." Returns a zip of one .md file per note/task/project
    (ai_core/export.py) as a direct download, not a signed Storage URL -
    there's no persisted artifact to protect, the zip is built fresh on
    each request and streamed straight back."""
    conn = None
    try:
        conn = psycopg.connect(get_settings().database_url)
        zip_bytes = build_export_zip(conn, user_id)
    except Exception:  # noqa: BLE001 - never leak exception internals to the client
        logger.exception("export failed for user %s", user_id)
        raise HTTPException(
            status_code=500, detail="Something went wrong exporting your data. Try again."
        )
    finally:
        if conn:
            conn.close()

    filename = f"second-brain-export-{date.today().isoformat()}.zip"
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
