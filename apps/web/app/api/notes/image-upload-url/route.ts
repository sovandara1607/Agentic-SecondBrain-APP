import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Same "size/type limits belong server-side" reasoning as
// apps/web/app/api/capture/upload-url/route.ts. Backs
// components/rich-text-editor.tsx's images_upload_handler (paste/drop/
// insert an image while editing a note).
const MAX_BYTES = 8 * 1024 * 1024;
const CONTENT_TYPE = /^image\//;

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-80) || "image";
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
  const filename = body?.filename as string | undefined;
  const contentType = body?.contentType as string | undefined;
  const size = Number(body?.size);

  if (!filename || !contentType || !Number.isFinite(size)) {
    return NextResponse.json({ detail: "Missing filename, contentType, or size" }, { status: 400 });
  }
  if (size <= 0 || size > MAX_BYTES) {
    return NextResponse.json(
      { detail: `Images must be under ${Math.floor(MAX_BYTES / (1024 * 1024))}MB` },
      { status: 400 },
    );
  }
  if (!CONTENT_TYPE.test(contentType)) {
    return NextResponse.json({ detail: `'${contentType}' isn't an image content type` }, { status: 400 });
  }

  // Path always starts with the caller's own user id - the storage RLS
  // policy (0009_note_images.sql: folder prefix = auth.uid()) scopes
  // every subsequent read/write to its owner without this route needing
  // to think about it further.
  const path = `${user.id}/${crypto.randomUUID()}-${sanitizeFilename(filename)}`;

  const { data, error } = await supabase.storage.from("note-images").createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json({ detail: "Couldn't create an upload URL" }, { status: 500 });
  }

  return NextResponse.json({ path: data.path, token: data.token });
}
