import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PriorityBadge } from "@/components/priority-badge";

const START_HOUR = 7;
const END_HOUR = 21;
const HOUR_HEIGHT = 48; // px
const GRID_HEIGHT = (END_HOUR - START_HOUR) * HOUR_HEIGHT;
const DAY_MS = 86_400_000;

type Block = {
  id: string;
  starts_at: string;
  ends_at: string;
  tasks: { id: string; title: string; priority: number } | null;
};

function startOfWeek(date: Date) {
  const d = new Date(date);
  const isoDay = d.getDay() === 0 ? 7 : d.getDay(); // Monday = 1 .. Sunday = 7
  d.setHours(0, 0, 0, 0);
  d.setTime(d.getTime() - (isoDay - 1) * DAY_MS);
  return d;
}

function offsetMinutes(dayStart: Date, iso: string) {
  const d = new Date(iso);
  return (d.getTime() - dayStart.getTime()) / 60_000 - START_HOUR * 60;
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

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setTime(d.getTime() + i * DAY_MS);
    return d;
  });

  const supabase = await createClient();
  const [{ data: blocks }, { data: atRisk }] = await Promise.all([
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
  ]);

  const blocksByDay = days.map((day) =>
    ((blocks ?? []) as unknown as Block[]).filter(
      (b) => new Date(b.starts_at).toDateString() === day.toDateString(),
    ),
  );

  const todayKey = now.toDateString();
  const nowOffset = offsetMinutes(startOfWeek(now), now.toISOString());
  const showNowLine = offset === 0 && nowOffset >= 0 && nowOffset <= (END_HOUR - START_HOUR) * 60;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Calendar</h1>
          <p className="text-sm text-muted-foreground">
            What the scheduler placed this week - edit a task&apos;s
            priority, deadline, or energy level and it&apos;s replanned on
            its next run.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Link href={`/calendar?offset=${offset - 1}`}>
            <Button type="button" variant="outline" size="icon">
              <ChevronLeft className="size-4" strokeWidth={1.75} />
            </Button>
          </Link>
          <Link href="/calendar">
            <Button type="button" variant="outline" size="sm">
              Today
            </Button>
          </Link>
          <Link href={`/calendar?offset=${offset + 1}`}>
            <Button type="button" variant="outline" size="icon">
              <ChevronRight className="size-4" strokeWidth={1.75} />
            </Button>
          </Link>
        </div>
      </div>

      {atRisk && atRisk.length > 0 && (
        <Card className="border-destructive/40">
          <CardContent className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm font-medium text-destructive">
              <AlertTriangle className="size-4" strokeWidth={1.75} />
              At risk - couldn&apos;t be scheduled before their deadline
            </div>
            <div className="flex flex-col gap-1.5">
              {atRisk.map((task) => {
                const project = task.projects as unknown as {
                  name: string;
                } | null;
                return (
                  <Link
                    key={task.id}
                    href={`/tasks/${task.id}`}
                    className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                  >
                    <span className="flex items-center gap-2 truncate">
                      {task.title}
                      {project && <Badge variant="muted">{project.name}</Badge>}
                    </span>
                    <PriorityBadge priority={task.priority} />
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="overflow-x-auto rounded-xl border border-border/60 bg-card shadow-[var(--shadow-raised-sm)]">
        <div className="grid min-w-[720px] grid-cols-[56px_repeat(7,1fr)]">
          <div />
          {days.map((day) => {
            const isToday = day.toDateString() === todayKey;
            return (
              <div
                key={day.toISOString()}
                className={`border-l border-border/60 px-2 py-2 text-center ${isToday ? "bg-primary/10" : ""}`}
              >
                <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  {day.toLocaleDateString(undefined, { weekday: "short" })}
                </p>
                <p
                  className={`font-heading text-sm ${isToday ? "font-semibold text-primary" : ""}`}
                >
                  {day.getDate()}
                </p>
              </div>
            );
          })}

          <div className="relative" style={{ height: GRID_HEIGHT }}>
            {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
              <div
                key={i}
                className="absolute right-1 -translate-y-1/2 text-[10px] text-muted-foreground"
                style={{ top: i * HOUR_HEIGHT }}
              >
                {((START_HOUR + i + 11) % 12) + 1}
                {START_HOUR + i < 12 ? "am" : "pm"}
              </div>
            ))}
          </div>

          {days.map((day, i) => {
            const isToday = day.toDateString() === todayKey;
            return (
              <div
                key={day.toISOString()}
                className="relative border-l border-border/60"
                style={{ height: GRID_HEIGHT }}
              >
                {Array.from({ length: END_HOUR - START_HOUR }, (_, h) => (
                  <div
                    key={h}
                    className="absolute w-full border-t border-border/40"
                    style={{ top: h * HOUR_HEIGHT }}
                  />
                ))}
                {isToday && showNowLine && (
                  <div
                    className="absolute z-10 w-full border-t-2 border-destructive"
                    style={{ top: (nowOffset / 60) * HOUR_HEIGHT }}
                  />
                )}
                {blocksByDay[i].map((block) => {
                  if (!block.tasks) return null;
                  const top = Math.max(
                    0,
                    (offsetMinutes(day, block.starts_at) / 60) * HOUR_HEIGHT,
                  );
                  const height = Math.max(
                    18,
                    ((new Date(block.ends_at).getTime() -
                      new Date(block.starts_at).getTime()) /
                      60_000 /
                      60) *
                      HOUR_HEIGHT,
                  );
                  return (
                    <Link
                      key={block.id}
                      href={`/tasks/${block.tasks.id}`}
                      className="absolute right-0.5 left-0.5 overflow-hidden truncate rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[11px] leading-tight whitespace-nowrap text-primary shadow-[var(--shadow-raised-sm)] transition-colors hover:bg-primary/20"
                      style={{ top, height }}
                    >
                      {block.tasks.title}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
