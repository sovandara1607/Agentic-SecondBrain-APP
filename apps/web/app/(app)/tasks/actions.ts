"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

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

// Manual scheduling writes time_blocks directly (a normal
// authenticated-user write time_blocks' RLS allows, unlike jobs) rather
// than going through the automatic scheduler, and sets the task straight
// to 'scheduled' on insert so 0003's on_task_created trigger's
// auto-placement run - which only considers status='open' tasks - never
// even sees it as a candidate. No race with the background scheduler to
// worry about because of that, not despite it.
async function applyManualSchedule(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
  startsAt: string,
  durationMinutes: number,
) {
  const startDate = new Date(startsAt);
  const endDate = new Date(startDate.getTime() + durationMinutes * 60_000);

  await supabase
    .from("time_blocks")
    .delete()
    .eq("task_id", taskId)
    .eq("status", "scheduled");

  const { error } = await supabase.from("time_blocks").insert({
    user_id: userId,
    task_id: taskId,
    starts_at: startDate.toISOString(),
    ends_at: endDate.toISOString(),
    status: "scheduled",
  });
  if (error) throw new Error(`Couldn't schedule the task: ${error.message}`);
}

export async function createTask(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;

  const scheduledAt = String(formData.get("scheduled_at") ?? "").trim();
  const durationRaw = String(formData.get("estimated_minutes") ?? "").trim();
  const durationMinutes = durationRaw ? Number(durationRaw) : 30;

  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      user_id: user.id,
      title,
      estimated_minutes: durationMinutes,
      status: scheduledAt ? "scheduled" : "open",
      ...parseTaskFields(formData),
    })
    .select("id")
    .single();
  if (error) throw new Error(`Couldn't add the task: ${error.message}`);

  if (scheduledAt) {
    await applyManualSchedule(supabase, user.id, task.id, scheduledAt, durationMinutes);
  }

  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  revalidatePath("/calendar");
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
  const durationMinutes = estimatedMinutesRaw ? Number(estimatedMinutesRaw) : 30;
  const scheduledAt = String(formData.get("scheduled_at") ?? "").trim();

  const { error } = await supabase
    .from("tasks")
    .update({
      title,
      context: context || null,
      estimated_minutes: durationMinutes,
      ...(scheduledAt ? { status: "scheduled" } : {}),
      ...parseTaskFields(formData),
    })
    .eq("id", id);
  if (error) throw new Error(`Couldn't save the task: ${error.message}`);

  if (scheduledAt) {
    await applyManualSchedule(supabase, user.id, id, scheduledAt, durationMinutes);
  }

  revalidatePath("/tasks");
  revalidatePath(`/tasks/${id}`);
  revalidatePath("/dashboard");
  revalidatePath("/calendar");
  redirect("/tasks");
}

export async function clearTaskSchedule(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await supabase
    .from("time_blocks")
    .delete()
    .eq("task_id", id)
    .eq("status", "scheduled");
  // Triggers on_task_reopened (0004), which re-enqueues a scheduler run
  // so this task gets auto-placed again rather than sitting open forever.
  const { error } = await supabase
    .from("tasks")
    .update({ status: "open" })
    .eq("id", id);
  if (error) throw new Error(`Couldn't clear the schedule: ${error.message}`);

  revalidatePath(`/tasks/${id}`);
  revalidatePath("/tasks");
  revalidatePath("/calendar");
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
  revalidatePath("/calendar");
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
  revalidatePath("/calendar");
}
