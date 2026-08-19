"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function scheduleTaskBlock(data: {
  taskId: string;
  startsAt: string; // ISO date string
  durationMinutes?: number;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { success: false, error: "Not authenticated" };

  const { taskId, startsAt, durationMinutes = 60 } = data;

  const startDate = new Date(startsAt);
  const endDate = new Date(startDate.getTime() + durationMinutes * 60_000);

  // Check if a time_block already exists for this task
  const { data: existingBlocks } = await supabase
    .from("time_blocks")
    .select("id")
    .eq("task_id", taskId)
    .eq("status", "scheduled");

  if (existingBlocks && existingBlocks.length > 0) {
    // Update existing scheduled block position
    const { error } = await supabase
      .from("time_blocks")
      .update({
        starts_at: startDate.toISOString(),
        ends_at: endDate.toISOString(),
      })
      .eq("id", existingBlocks[0].id);

    if (error) return { success: false, error: error.message };
  } else {
    // Insert new scheduled block
    const { error } = await supabase.from("time_blocks").insert({
      user_id: user.id,
      task_id: taskId,
      starts_at: startDate.toISOString(),
      ends_at: endDate.toISOString(),
      status: "scheduled",
    });

    if (error) return { success: false, error: error.message };
  }

  // Update task status from open/at_risk to scheduled if needed - "todo"
  // and "inbox" aren't real values in this schema's status enum (Section
  // 4: open | scheduled | in_progress | done | at_risk | canceled), and
  // since the column has no CHECK constraint, writing them silently
  // "succeeded" while producing tasks nothing else in the app recognized
  // (wrong badge, excluded from the scheduler's status='open' candidate
  // set, wrong Dashboard counts). Same status apps/web/app/(app)/tasks/
  // actions.ts's applyManualSchedule already uses for the equivalent
  // task-detail-page scheduling path.
  await supabase
    .from("tasks")
    .update({ status: "scheduled" })
    .eq("id", taskId)
    .in("status", ["open", "at_risk"]);

  revalidatePath("/calendar");
  revalidatePath("/tasks");
  revalidatePath("/dashboard");

  return { success: true };
}

export async function createAndScheduleTask(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  const title = String(formData.get("title") ?? "").trim();
  const startsAt = String(formData.get("starts_at") ?? "");
  const priority = Number(formData.get("priority") ?? 2);
  const projectId = String(formData.get("project_id") ?? "") || null;
  const durationMinutes = Number(formData.get("duration") ?? 60);

  if (!title || !startsAt) return;

  // Insert Task
  const { data: task, error: taskErr } = await supabase
    .from("tasks")
    .insert({
      user_id: user.id,
      title,
      priority,
      status: "scheduled", // a time_block is created for it immediately below
      project_id: projectId,
    })
    .select("id")
    .single();

  if (taskErr || !task) throw new Error(taskErr?.message ?? "Could not create task");

  const startDate = new Date(startsAt);
  const endDate = new Date(startDate.getTime() + durationMinutes * 60_000);

  // Create time block
  await supabase.from("time_blocks").insert({
    user_id: user.id,
    task_id: task.id,
    starts_at: startDate.toISOString(),
    ends_at: endDate.toISOString(),
    status: "scheduled",
  });

  revalidatePath("/calendar");
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}

export async function unscheduleTaskBlock(blockId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { success: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("time_blocks")
    .delete()
    .eq("id", blockId)
    .eq("user_id", user.id);

  if (error) return { success: false, error: error.message };

  revalidatePath("/calendar");
  revalidatePath("/tasks");
  revalidatePath("/dashboard");

  return { success: true };
}
