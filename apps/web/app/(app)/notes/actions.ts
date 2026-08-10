"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import TurndownService from "turndown";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

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

// Turndown escapes markdown-significant characters in plain text, brackets
// included, so a literal "[[Design Brief]]" typed in the editor is stored
// as "\[\[Design Brief\]\]" - each bracket optionally backslash-escaped.
const WIKILINK_PATTERN = /\\?\[\\?\[([^\]]+?)\\?\]\\?\]/g;

// Backlinks: [[Note Title]] anywhere in a note's markdown content becomes
// a 'mentions' row in relationships, resolved by title match against the
// same user's other notes. Re-synced on every save (delete this note's
// outgoing 'mentions' rows, re-derive from current content) rather than
// diffed, since content edits can add/remove links in ways that are
// simpler to recompute than to patch incrementally.
async function syncBacklinks(
  supabase: SupabaseClient,
  userId: string,
  noteId: string,
  content: string,
) {
  const titles = [...content.matchAll(WIKILINK_PATTERN)].map((m) =>
    m[1].trim(),
  );

  await supabase
    .from("relationships")
    .delete()
    .eq("user_id", userId)
    .eq("source_type", "note")
    .eq("source_id", noteId)
    .eq("relation_kind", "mentions");

  if (titles.length === 0) return;

  const { data: matches } = await supabase
    .from("notes")
    .select("id, title")
    .eq("user_id", userId)
    .neq("id", noteId)
    .in("title", titles);

  if (!matches?.length) return;

  await supabase.from("relationships").insert(
    matches.map((match) => ({
      user_id: userId,
      source_type: "note",
      source_id: noteId,
      target_type: "note",
      target_id: match.id,
      relation_kind: "mentions",
    })),
  );
}

function parseNoteFields(formData: FormData) {
  const noteType = String(formData.get("note_type") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  return {
    note_type: noteType || "note",
    project_id: projectId || null,
  };
}

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
    .insert({ user_id: user.id, title, content, ...parseNoteFields(formData) })
    .select("id")
    .single();
  if (error) throw new Error(`Couldn't save the note: ${error.message}`);

  await syncBacklinks(supabase, user.id, note.id, content);

  revalidatePath("/notes");
  revalidatePath("/dashboard");
  redirect(`/notes/${note.id}`);
}

export async function saveNoteContent(data: {
  id: string;
  title: string;
  html: string;
  note_type: string;
  project_id: string | null;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const { id, title, html, note_type, project_id } = data;
  if (!id || !title.trim()) return { success: false, error: "Title required" };
  const content = turndown.turndown(html || "");

  const { error } = await supabase
    .from("notes")
    .update({
      title: title.trim(),
      content,
      note_type: note_type || "note",
      project_id: project_id || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return { success: false, error: error.message };

  await syncBacklinks(supabase, user.id, id, content);

  revalidatePath(`/notes/${id}`);
  revalidatePath("/notes");
  revalidatePath("/dashboard");

  return { success: true };
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
    .update({ title, content, ...parseNoteFields(formData) })
    .eq("id", id);
  if (error) throw new Error(`Couldn't save changes: ${error.message}`);

  await syncBacklinks(supabase, user.id, id, content);

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

// taggables has no user_id column of its own - ownership is derived by
// joining to whichever row taggable_id points at. Its RLS delete policy
// (0001_initial_schema.sql) only checks the *tag's* owner, not the
// note's, since a tag can only ever be attached to its own owner's
// content via the insert policy - correct today, but an app-layer check
// shouldn't lean on that assumption holding forever. Verifying note
// ownership explicitly here, before touching taggables, keeps
// authorization in the code, not implied by a policy at a different
// layer.
async function assertOwnsNote(
  supabase: SupabaseClient,
  userId: string,
  noteId: string,
) {
  const { data } = await supabase
    .from("notes")
    .select("id")
    .eq("id", noteId)
    .eq("user_id", userId)
    .single();
  if (!data) throw new Error("Note not found.");
}

export async function addNoteTag(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const noteId = String(formData.get("note_id") ?? "");
  const name = String(formData.get("tag_name") ?? "").trim().toLowerCase();
  if (!noteId || !name) return;
  await assertOwnsNote(supabase, user.id, noteId);

  const { data: tag, error: tagError } = await supabase
    .from("tags")
    .upsert({ user_id: user.id, name }, { onConflict: "user_id,name" })
    .select("id")
    .single();
  if (tagError) throw new Error(`Couldn't add the tag: ${tagError.message}`);

  const { error } = await supabase
    .from("taggables")
    .insert({ tag_id: tag.id, taggable_type: "note", taggable_id: noteId });
  if (error && error.code !== "23505") {
    throw new Error(`Couldn't add the tag: ${error.message}`);
  }

  revalidatePath(`/notes/${noteId}`);
}

export async function removeNoteTag(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const noteId = String(formData.get("note_id") ?? "");
  const tagId = String(formData.get("tag_id") ?? "");
  if (!noteId || !tagId) return;
  await assertOwnsNote(supabase, user.id, noteId);

  const { error } = await supabase
    .from("taggables")
    .delete()
    .eq("tag_id", tagId)
    .eq("taggable_type", "note")
    .eq("taggable_id", noteId);
  if (error) throw new Error(`Couldn't remove the tag: ${error.message}`);

  revalidatePath(`/notes/${noteId}`);
}
