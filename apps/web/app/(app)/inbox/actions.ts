"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createCapture(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const rawText = String(formData.get("raw_text") ?? "").trim();
  const sourceUrl = String(formData.get("source_url") ?? "").trim();
  if (!rawText && !sourceUrl) return;

  const { error } = await supabase.from("captures").insert({
    user_id: user.id,
    kind: sourceUrl ? "url" : "text",
    raw_text: rawText || null,
    source_url: sourceUrl || null,
  });
  if (error) throw new Error(`Couldn't save the capture: ${error.message}`);

  revalidatePath("/inbox");
  revalidatePath("/dashboard");
}

const MEDIA_KINDS = new Set(["voice", "image", "pdf"]);

export async function createFileCapture({
  kind,
  storagePath,
}: {
  kind: string;
  storagePath: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!MEDIA_KINDS.has(kind)) throw new Error(`Unsupported capture kind '${kind}'`);
  if (!storagePath.startsWith(`${user.id}/`)) {
    // Belt and suspenders: the upload route already only ever mints
    // paths under the caller's own id, so this should be unreachable,
    // but a capture row pointing at another user's storage path is bad
    // enough to guard against directly rather than trust the caller.
    throw new Error("Invalid storage path");
  }

  const { error } = await supabase.from("captures").insert({
    user_id: user.id,
    kind,
    storage_path: storagePath,
  });
  if (error) throw new Error(`Couldn't save the capture: ${error.message}`);

  revalidatePath("/inbox");
  revalidatePath("/dashboard");
}

export async function deleteCapture(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { error } = await supabase.from("captures").delete().eq("id", id);
  if (error) throw new Error(`Couldn't delete the capture: ${error.message}`);

  revalidatePath("/inbox");
  revalidatePath("/dashboard");
}
