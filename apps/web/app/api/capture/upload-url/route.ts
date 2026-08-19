import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Section 5.1: "kept server-side to apply size/type limits before
// issuing the URL" - the size/type checks below are the entire reason
// this exists as a route instead of the browser calling
// storage.createSignedUploadUrl() directly.
const LIMITS: Record<string, { maxBytes: number; contentTypes: RegExp }> = {
  voice: { maxBytes: 15 * 1024 * 1024, contentTypes: /^audio\// },
  image: { maxBytes: 10 * 1024 * 1024, contentTypes: /^image\// },
  pdf: { maxBytes: 20 * 1024 * 1024, contentTypes: /^application\/pdf$/ },
};

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-80) || "upload";
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const kind = body?.kind as string | undefined;
  const filename = body?.filename as string | undefined;
  const contentType = body?.contentType as string | undefined;
  const size = Number(body?.size);

  if (!kind || !filename || !contentType || !Number.isFinite(size)) {
    return NextResponse.json({ detail: "Missing kind, filename, contentType, or size" }, { status: 400 });
  }

  const limit = LIMITS[kind];
  if (!limit) {
    return NextResponse.json({ detail: `Unsupported kind '${kind}'` }, { status: 400 });
  }
  if (size <= 0 || size > limit.maxBytes) {
    return NextResponse.json(
      { detail: `${kind} uploads must be under ${Math.floor(limit.maxBytes / (1024 * 1024))}MB` },
      { status: 400 },
    );
  }
  if (!limit.contentTypes.test(contentType)) {
    return NextResponse.json(
      { detail: `'${contentType}' isn't a valid content type for a ${kind} capture` },
      { status: 400 },
    );
  }

  // Path always starts with the caller's own user id, so the storage
  // RLS policy (0006_capture_storage.sql: folder prefix = auth.uid())
  // scopes every subsequent read/write to its owner without this route
  // needing to think about it further.
  const path = `${user.id}/${crypto.randomUUID()}-${sanitizeFilename(filename)}`;

  const { data, error } = await supabase.storage.from("captures").createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json({ detail: "Couldn't create an upload URL" }, { status: 500 });
  }

  return NextResponse.json({ path: data.path, token: data.token });
}
