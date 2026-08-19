import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Serves images embedded in note content (components/rich-text-editor.tsx)
// back out of the private `note-images` bucket. A plain `<img src="...">`
// request can't carry a bearer token, so this relies on the same
// cookie-based session every other page in the app already uses
// (@supabase/ssr sends the session cookie automatically on a same-origin
// request) rather than a public bucket URL baked permanently into the
// note's stored markdown.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new NextResponse(null, { status: 401 });
  }

  const { path: segments } = await params;
  const path = segments.join("/");
  // Belt and suspenders on top of storage RLS (0009_note_images.sql) -
  // never even ask Storage for a path outside the caller's own folder.
  if (!path.startsWith(`${user.id}/`)) {
    return new NextResponse(null, { status: 404 });
  }

  const { data, error } = await supabase.storage.from("note-images").createSignedUrl(path, 60);
  if (error || !data) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.redirect(data.signedUrl);
}
