"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createTask(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;

  await supabase.from("tasks").insert({ user_id: user.id, title });

  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}

export async function toggleTaskDone(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const id = String(formData.get("id") ?? "");
  const wasDone = formData.get("was_done") === "true";
  if (!id) return;

  await supabase
    .from("tasks")
    .update({
      status: wasDone ? "open" : "done",
      completed_at: wasDone ? null : new Date().toISOString(),
    })
    .eq("id", id);

  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}
