"""Thin Supabase Storage read path for the worker's pipeline processing.

The worker has no per-request user session (Section 11 point 7): it uses
the service role key, which bypasses Storage RLS the same way it
bypasses table RLS, so every call here reads whatever object path it's
given. That's safe in practice only because the upload route
(apps/web/app/api/capture/upload-url/route.ts) always writes objects
under `{user_id}/...` and the `storage_path` a capture row carries always
came from that same upload flow - there's no user-controlled path input
on this read path to misuse.
"""

from __future__ import annotations

import os

import httpx

CAPTURES_BUCKET = "captures"


def download_capture_object(storage_path: str) -> bytes:
    supabase_url = os.environ["SUPABASE_URL"].rstrip("/")
    service_role_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

    response = httpx.get(
        f"{supabase_url}/storage/v1/object/{CAPTURES_BUCKET}/{storage_path}",
        headers={
            "Authorization": f"Bearer {service_role_key}",
            "apikey": service_role_key,
        },
        timeout=30.0,
    )
    response.raise_for_status()
    return response.content
