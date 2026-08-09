"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createNote(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  if (!title || !content) return;

  const { data: note } = await supabase
    .from("notes")
    .insert({ user_id: user.id, title, content })
    .select("id")
    .single();

  revalidatePath("/notes");
  revalidatePath("/dashboard");
  if (note) redirect(`/notes/${note.id}`);
}
