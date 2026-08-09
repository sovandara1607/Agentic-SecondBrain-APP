"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createTask(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;

  const { error } = await supabase
    .from("tasks")
    .insert({ user_id: user.id, title });
  if (error) throw new Error(`Couldn't add the task: ${error.message}`);

  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}

export async function toggleTaskDone(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const id = String(formData.get("id") ?? "");
  const wasDone = formData.get("was_done") === "true";
  if (!id) return;

  const { error } = await supabase
    .from("tasks")
    .update({
      status: wasDone ? "open" : "done",
      completed_at: wasDone ? null : new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(`Couldn't update the task: ${error.message}`);

  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}

export async function deleteTask(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw new Error(`Couldn't delete the task: ${error.message}`);

  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}
