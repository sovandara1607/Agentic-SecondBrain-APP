import { createClient } from "@/lib/supabase/server";
import { CalendarClient } from "./calendar-client";

const DAY_MS = 86_400_000;

function startOfWeek(date: Date) {
  const d = new Date(date);
  const isoDay = d.getDay() === 0 ? 7 : d.getDay();
  d.setHours(0, 0, 0, 0);
  d.setTime(d.getTime() - (isoDay - 1) * DAY_MS);
  return d;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string }>;
}) {
  const { offset: offsetParam } = await searchParams;
  const offset = Number(offsetParam ?? 0) || 0;

  const now = new Date();
  const weekStart = startOfWeek(now);
  weekStart.setTime(weekStart.getTime() + offset * 7 * DAY_MS);
  const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS);

  const supabase = await createClient();

  const [
    { data: blocks },
    { data: atRisk },
    { data: unscheduledTasks },
    { data: projects },
  ] = await Promise.all([
    supabase
      .from("time_blocks")
      .select("id, starts_at, ends_at, tasks(id, title, priority)")
      .eq("status", "scheduled")
      .gte("starts_at", weekStart.toISOString())
      .lt("starts_at", weekEnd.toISOString())
      .order("starts_at"),
    supabase
      .from("tasks")
      .select("id, title, priority, deadline, projects(name)")
      .eq("status", "at_risk")
      .order("priority"),
    supabase
      .from("tasks")
      .select("id, title, priority, projects(name)")
      .in("status", ["inbox", "todo"])
      .order("priority")
      .limit(20),
    supabase.from("projects").select("id, name").order("name"),
  ]);

  return (
    <CalendarClient
      offset={offset}
      blocks={(blocks ?? []) as unknown as Parameters<typeof CalendarClient>[0]["blocks"]}
      atRisk={(atRisk ?? []) as unknown as Parameters<typeof CalendarClient>[0]["atRisk"]}
      unscheduledTasks={(unscheduledTasks ?? []) as unknown as Parameters<typeof CalendarClient>[0]["unscheduledTasks"]}
      projects={projects ?? []}
    />
  );
}
