import { getSettings } from "./storage";

export type CaptureResult =
  | { ok: true; id: string; status: string }
  | { ok: false; error: string };

// The one API call this whole extension exists to make: POST /captures
// (apps/api/routers/captures.py), the endpoint already built for
// "users who want to script their own capture sources" - same
// raw_text/source_url shape, same pipeline, same Inbox row a capture
// made from the app itself would produce. Auth is a personal access
// token (apps/web/components/api-tokens-panel.tsx generates the
// sb_pat_... format core/auth.py's verify_jwt_or_api_token expects) -
// no session, no cookies, nothing else to wire up.
export async function createCapture(
  body: { raw_text?: string; source_url?: string },
): Promise<CaptureResult> {
  const settings = await getSettings();
  if (!settings) {
    return { ok: false, error: "Not set up yet - open the extension's options page." };
  }
  if (!body.raw_text && !body.source_url) {
    return { ok: false, error: "Nothing to capture." };
  }

  try {
    const res = await fetch(`${settings.apiUrl.replace(/\/$/, "")}/captures`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.token}`,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 401) {
      return { ok: false, error: "That token was rejected - check it in the options page." };
    }
    if (!res.ok) {
      return { ok: false, error: `Capture failed (${res.status}). Try again.` };
    }

    const data = (await res.json()) as { id: string; status: string };
    return { ok: true, id: data.id, status: data.status };
  } catch {
    // Covers a wrong/unreachable API URL, CORS misconfiguration, or the
    // network simply being down - fetch() throws for all three rather
    // than resolving with a status code.
    return { ok: false, error: "Couldn't reach the API - check the URL in options." };
  }
}
