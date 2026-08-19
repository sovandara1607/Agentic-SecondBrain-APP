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

// Would inserting (task_id depends on targetId) create a cycle? True
// iff targetId already (transitively) depends on task_id - walked as a
// bounded BFS in JS rather than a recursive SQL query, since there's no
// stored procedure for it and this app's other validations are already
// done in server actions, not DB triggers. ai_core/agents/planner.py's
// own decompose_project has the same "no cycle detection" caveat
// documented for its auto-generated dependencies ("a real decomposition
// ... is a DAG by construction ... worth revisiting if this agent is
// ever driven by less structured input") - a human manually picking one
// dependency at a time in this UI *is* that less-structured input, so
// it gets the check the agent didn't need.
async function wouldCreateCycle(
  supabase: SupabaseClient,
  taskId: string,
  targetId: string,
): Promise<boolean> {
  let frontier = [targetId];
  const seen = new Set([targetId]);
  for (let hop = 0; hop < 20 && frontier.length; hop++) {
    const { data } = await supabase
      .from("task_dependencies")
      .select("depends_on_task_id")
      .in("task_id", frontier);
    const next = [...new Set((data ?? []).map((d) => d.depends_on_task_id))].filter(
      (id) => !seen.has(id),
    );
    if (next.includes(taskId)) return true;
    next.forEach((id) => seen.add(id));
    frontier = next;
  }
  return false;
}

export async function addTaskDependency(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const taskId = String(formData.get("task_id") ?? "");
  const dependsOnTaskId = String(formData.get("depends_on_task_id") ?? "");
  if (!taskId || !dependsOnTaskId) return;
  if (taskId === dependsOnTaskId) {
    throw new Error("A task can't depend on itself.");
  }

  // Redundant with RLS (0001_initial_schema.sql's task_dependencies
  // insert policy already validates ownership of *both* task_id and
  // depends_on_task_id via exists-subqueries - verified directly against
  // a real cross-user attempt: 403, zero rows written either direction).
  // Kept anyway for a clean error instead of a raw Postgres RLS
  // violation, matching every other ownership check in this codebase.
  const { data: owned } = await supabase
    .from("tasks")
    .select("id")
    .in("id", [taskId, dependsOnTaskId])
    .eq("user_id", user.id);
  if ((owned?.length ?? 0) !== 2) {
    throw new Error("Couldn't add that dependency.");
  }

  if (await wouldCreateCycle(supabase, taskId, dependsOnTaskId)) {
    throw new Error("That would create a dependency cycle.");
  }

  const { error } = await supabase
    .from("task_dependencies")
    .insert({ task_id: taskId, depends_on_task_id: dependsOnTaskId });
  if (error) throw new Error(`Couldn't add the dependency: ${error.message}`);

  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/tasks");
  revalidatePath("/calendar");
}

export async function removeTaskDependency(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const taskId = String(formData.get("task_id") ?? "");
  const dependsOnTaskId = String(formData.get("depends_on_task_id") ?? "");
  if (!taskId || !dependsOnTaskId) return;

  // Same defense-in-depth as addTaskDependency above - RLS's delete
  // policy already scopes this to rows whose task_id the caller owns.
  const { data: owned } = await supabase.from("tasks").select("id").eq("id", taskId).eq("user_id", user.id);
  if (!owned?.length) {
    throw new Error("Couldn't remove that dependency.");
  }

  const { error } = await supabase
    .from("task_dependencies")
    .delete()
    .eq("task_id", taskId)
    .eq("depends_on_task_id", dependsOnTaskId);
  if (error) throw new Error(`Couldn't remove the dependency: ${error.message}`);

  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/tasks");
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
