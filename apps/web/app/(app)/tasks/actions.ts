"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function parseTaskFields(formData: FormData) {
  const priorityRaw = String(formData.get("priority") ?? "").trim();
  const deadlineRaw = String(formData.get("deadline") ?? "").trim();
  const projectIdRaw = String(formData.get("project_id") ?? "").trim();
  const energyLevel = String(formData.get("energy_level") ?? "").trim();

  return {
    priority: priorityRaw ? Number(priorityRaw) : 3,
    deadline: deadlineRaw || null,
    project_id: projectIdRaw || null,
    energy_level: energyLevel || "medium",
  };
}

export async function createTask(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;

  const { error } = await supabase.from("tasks").insert({
    user_id: user.id,
    title,
    ...parseTaskFields(formData),
  });
  if (error) throw new Error(`Couldn't add the task: ${error.message}`);

  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}

export async function updateTask(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const id = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!id || !title) return;
  const context = String(formData.get("context") ?? "").trim();
  const estimatedMinutesRaw = String(
    formData.get("estimated_minutes") ?? "",
  ).trim();

  const { error } = await supabase
    .from("tasks")
    .update({
      title,
      context: context || null,
      estimated_minutes: estimatedMinutesRaw
        ? Number(estimatedMinutesRaw)
        : 30,
      ...parseTaskFields(formData),
    })
    .eq("id", id);
  if (error) throw new Error(`Couldn't save the task: ${error.message}`);

  revalidatePath("/tasks");
  revalidatePath(`/tasks/${id}`);
  revalidatePath("/dashboard");
  redirect("/tasks");
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
