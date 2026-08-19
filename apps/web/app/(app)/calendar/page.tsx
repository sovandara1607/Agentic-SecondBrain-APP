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

function startOfMonth(date: Date, monthOffset: number) {
  return new Date(date.getFullYear(), date.getMonth() + monthOffset, 1);
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string; view?: string }>;
}) {
  const { offset: offsetParam, view: viewParam } = await searchParams;
  const offset = Number(offsetParam ?? 0) || 0;
  const view = viewParam === "month" ? "month" : "week";

  const now = new Date();
  let rangeStart: Date;
  let rangeEnd: Date;

  if (view === "month") {
    rangeStart = startOfMonth(now, offset);
    rangeEnd = startOfMonth(now, offset + 1);
  } else {
    rangeStart = startOfWeek(now);
    rangeStart.setTime(rangeStart.getTime() + offset * 7 * DAY_MS);
    rangeEnd = new Date(rangeStart.getTime() + 7 * DAY_MS);
  }

  const supabase = await createClient();

  const [
    { data: blocks, error: blocksError },
    { data: atRisk, error: atRiskError },
    { data: unscheduledTasks, error: unscheduledError },
    { data: projects, error: projectsError },
  ] = await Promise.all([
    supabase
      .from("time_blocks")
      .select("id, starts_at, ends_at, tasks(id, title, priority)")
      .eq("status", "scheduled")
      .gte("starts_at", rangeStart.toISOString())
      .lt("starts_at", rangeEnd.toISOString())
      // `.order("starts_at")` alone has no tiebreaker, so Postgres
      // doesn't guarantee the same row order across repeated queries
      // for blocks sharing a start time (or any time close enough that
      // the planner's sort is otherwise free to reorder them). The
      // week grid's overlap-lane layout (calendar-client.tsx's
      // layoutDayBlocks) assigns side-by-side lanes greedily in array
      // order, so an unstable order made tied/overlapping blocks
      // visibly swap lanes on every refetch - looked exactly like a
      // block's time "jumping" on its own, especially now that the
      // Realtime refresher (0011_realtime_publication.sql) triggers a
      // refetch far more often than a manual page reload used to.
      // `id` as a secondary key makes the order fully deterministic.
      .order("starts_at")
      .order("id"),
    supabase
      .from("tasks")
      .select("id, title, priority, deadline, projects(name)")
      .eq("status", "at_risk")
      .order("priority"),
    // tasks.status has no "inbox"/"todo" value (Section 4's enum is
    // open | scheduled | in_progress | done | at_risk | canceled, same
    // set the scheduler's own candidate-set query uses) - this used to
    // filter on values that can never match, so "Unscheduled" always
    // rendered empty regardless of how many open tasks actually existed.
    supabase
      .from("tasks")
      .select("id, title, priority, projects(name)")
      .eq("status", "open")
      .order("priority")
      .limit(20),
    supabase.from("projects").select("id, name").order("name"),
  ]);

  // `data ?? []` below is a deliberate fallback for "genuinely no rows",
  // not for "the query failed" - those look identical to the rendered
  // page (an empty grid) unless the failure is logged somewhere. A
  // report of "after refresh it all gone" (every block missing, not
  // just recently-changed ones) is exactly what a silently-swallowed
  // error here would look like - RLS/auth/session hiccups included -
  // so surface it loudly instead of guessing blind next time.
  for (const [label, error] of [
    ["time_blocks", blocksError],
    ["at-risk tasks", atRiskError],
    ["unscheduled tasks", unscheduledError],
    ["projects", projectsError],
  ] as const) {
    if (error) {
      console.error(`calendar page: ${label} query failed:`, error);
    }
  }

  return (
    <CalendarClient
      view={view}
      offset={offset}
      blocks={(blocks ?? []) as unknown as Parameters<typeof CalendarClient>[0]["blocks"]}
      atRisk={(atRisk ?? []) as unknown as Parameters<typeof CalendarClient>[0]["atRisk"]}
      unscheduledTasks={(unscheduledTasks ?? []) as unknown as Parameters<typeof CalendarClient>[0]["unscheduledTasks"]}
      projects={projects ?? []}
    />
  );
}
