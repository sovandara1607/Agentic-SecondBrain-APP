"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createNote(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  if (!title || !content) return;

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
  const content = String(formData.get("content") ?? "").trim();
  if (!id || !title || !content) return;

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
