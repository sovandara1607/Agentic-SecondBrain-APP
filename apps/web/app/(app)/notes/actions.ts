"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import TurndownService from "turndown";
import { createClient } from "@/lib/supabase/server";

// notes.content is markdown (see the migration's column comment) - both
// for backlink/display simplicity and because the Phase 1 AI pipeline
// (summarize/generate_tags/create_embeddings) expects plain-ish text, not
// HTML markup. TinyMCE is an HTML editor, so its output is converted back
// to markdown here, at the one place content is written. The reverse
// (markdown -> HTML for the editor to load) happens in notes/[id]/page.tsx
// via `marked`, server-side, right before rendering the editor.
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

export async function createNote(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const title = String(formData.get("title") ?? "").trim();
  const html = String(formData.get("content") ?? "").trim();
  if (!title || !html) return;
  const content = turndown.turndown(html);

  const { data: note, error } = await supabase
    .from("notes")
    .insert({ user_id: user.id, title, content })
    .select("id")
    .single();
  if (error) throw new Error(`Couldn't save the note: ${error.message}`);

  revalidatePath("/notes");
  revalidatePath("/dashboard");
  redirect(`/notes/${note.id}`);
}

export async function updateNote(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const id = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const html = String(formData.get("content") ?? "").trim();
  if (!id || !title || !html) return;
  const content = turndown.turndown(html);

  const { error } = await supabase
    .from("notes")
    .update({ title, content })
    .eq("id", id);
  if (error) throw new Error(`Couldn't save changes: ${error.message}`);

  revalidatePath(`/notes/${id}`);
  revalidatePath("/notes");
  revalidatePath("/dashboard");
}

export async function deleteNote(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { error } = await supabase.from("notes").delete().eq("id", id);
  if (error) throw new Error(`Couldn't delete the note: ${error.message}`);

  revalidatePath("/notes");
  revalidatePath("/dashboard");
  redirect("/notes");
}
