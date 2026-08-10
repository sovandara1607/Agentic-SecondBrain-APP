import Link from "next/link";
import { AlertTriangle, Calendar as CalendarIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { PriorityBadge } from "@/components/priority-badge";

type TimeBlockRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  tasks: { id: string; title: string; priority: number } | null;
};

function dayLabel(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export default async function CalendarPage() {
  const supabase = await createClient();
  const now = new Date();
  const horizonEnd = new Date(now.getTime() + 14 * 86_400_000);

  const [{ data: blocks }, { data: atRisk }] = await Promise.all([
    supabase
      .from("time_blocks")
      .select("id, starts_at, ends_at, tasks(id, title, priority)")
      .eq("status", "scheduled")
      .gte("starts_at", now.toISOString())
      .lte("starts_at", horizonEnd.toISOString())
      .order("starts_at"),
    supabase
      .from("tasks")
      .select("id, title, priority, deadline, projects(name)")
      .eq("status", "at_risk")
      .order("priority"),
  ]);

  const byDay = new Map<string, TimeBlockRow[]>();
  for (const block of (blocks ?? []) as unknown as TimeBlockRow[]) {
    const dateKey = block.starts_at.slice(0, 10);
    if (!byDay.has(dateKey)) byDay.set(dateKey, []);
    byDay.get(dateKey)!.push(block);
  }
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Calendar</h1>
        <p className="text-sm text-muted-foreground">
          What the scheduler placed for the next two weeks, deterministically
          - see a task&apos;s detail page to change priority, deadline, or
          energy level and it&apos;ll be replanned on its next run.
        </p>
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

      {days.length ? (
        <div className="space-y-4">
          {days.map(([dateKey, dayBlocks]) => (
            <div key={dateKey} className="space-y-1.5">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {dayLabel(dateKey)}
              </p>
              <div className="space-y-1.5">
                {dayBlocks.map((block) => (
                  <Card key={block.id}>
                    <CardContent className="flex items-center gap-3">
                      <span className="w-28 shrink-0 text-xs text-muted-foreground">
                        {new Date(block.starts_at).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                        {" - "}
                        {new Date(block.ends_at).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                      {block.tasks && (
                        <>
                          <Link
                            href={`/tasks/${block.tasks.id}`}
                            className="flex-1 truncate text-sm hover:underline"
                          >
                            {block.tasks.title}
                          </Link>
                          <PriorityBadge priority={block.tasks.priority} />
                        </>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        !atRisk?.length && (
          <EmptyState
            icon={CalendarIcon}
            title="Nothing scheduled"
            description="Add a task and the scheduler will place it here automatically, based on your priority, deadline, and working hours in Settings."
          />
        )
      )}
    </div>
  );
}
