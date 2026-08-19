"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { PriorityBadge } from "@/components/priority-badge";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { useLocale } from "@/lib/i18n/locale-provider";
import { cn } from "@/lib/utils";
import {
  scheduleTaskBlock,
  createAndScheduleTask,
  unscheduleTaskBlock,
} from "./calendar-actions";

const START_HOUR = 7;
const END_HOUR = 21;
const HOUR_HEIGHT = 64; // px - was 52; taller rows read more like actual clock time and give drag/click targets more room
const MIN_BLOCK_HEIGHT = 34; // px - was 26; a 15-30min task still needs room for a legible title + time line
const DAY_MS = 86_400_000;
const MONTH_CELLS = 42; // 6 fixed rows, keeps the grid height stable across months

type Project = { id: string; name: string };

type TaskItem = {
  id: string;
  title: string;
  priority: number;
  deadline?: string | null;
  projects?: { name: string } | null;
};

type Block = {
  id: string;
  starts_at: string;
  ends_at: string;
  tasks: { id: string; title: string; priority: number } | null;
};

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

function offsetMinutes(dayStart: Date, iso: string) {
  const d = new Date(iso);
  return (d.getTime() - dayStart.getTime()) / 60_000 - START_HOUR * 60;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// Overlapping/back-to-back blocks were all rendered at the day column's
// full width (`right-1 left-1`, unconditionally), so any day with more
// than one task scheduled near the same time visually collided - the
// blocks didn't fit into the grid so much as stack directly on top of
// each other. This is the standard calendar-UI layout algorithm
// (Google Calendar/Outlook use a version of it): greedily assign each
// block to the first "lane" (column) whose most recent block has
// already ended, splitting overlapping blocks side-by-side instead of
// on top of each other. Blocks are then grouped into overlap clusters
// (a run of blocks with no time gap between any of them) so a block's
// width only shrinks to fit the blocks it actually overlaps with, not
// the busiest moment anywhere else in the day.
// Above this many concurrent blocks, splitting every one into an equal
// side-by-side lane produces slivers too narrow to show more than a
// single letter (five overlapping tasks in a ~180px day column means
// ~36px each) - unreadable, not just tight. MAX_VISIBLE_LANES caps how
// many actually render at full lane width; anything past that collapses
// into one "+N more" chip that opens the full list in a dialog instead.
const MAX_VISIBLE_LANES = 3;

type DayLayout = {
  lanes: Map<string, { lane: number; laneCount: number }>;
  clusters: Block[][];
};

function layoutDayBlocks(dayBlocks: Block[]): DayLayout {
  const events = dayBlocks
    .filter((b) => b.tasks)
    .map((b) => ({
      block: b,
      start: new Date(b.starts_at).getTime(),
      end: new Date(b.ends_at).getTime(),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const lanes: { end: number }[] = [];
  const laneOf = new Map<string, number>();
  const groupOf = new Map<string, number>();
  let groupId = -1;
  let groupEnd = -Infinity;

  for (const ev of events) {
    if (ev.start >= groupEnd) {
      groupId++;
    }
    groupEnd = Math.max(groupEnd, ev.end);
    groupOf.set(ev.block.id, groupId);

    let lane = lanes.findIndex((l) => l.end <= ev.start);
    if (lane === -1) {
      lane = lanes.length;
      lanes.push({ end: ev.end });
    } else {
      lanes[lane].end = ev.end;
    }
    laneOf.set(ev.block.id, lane);
  }

  const maxLaneByGroup = new Map<number, number>();
  const clusterBlocks = new Map<number, Block[]>();
  for (const ev of events) {
    const g = groupOf.get(ev.block.id)!;
    const lane = laneOf.get(ev.block.id)!;
    maxLaneByGroup.set(g, Math.max(maxLaneByGroup.get(g) ?? 0, lane));
    (clusterBlocks.get(g) ?? clusterBlocks.set(g, []).get(g)!).push(ev.block);
  }

  const result = new Map<string, { lane: number; laneCount: number }>();
  for (const ev of events) {
    const g = groupOf.get(ev.block.id)!;
    result.set(ev.block.id, {
      lane: laneOf.get(ev.block.id)!,
      laneCount: (maxLaneByGroup.get(g) ?? 0) + 1,
    });
  }
  return { lanes: result, clusters: [...clusterBlocks.values()] };
}

// Solid, high-contrast fills for the small block cards - mapped to the
// same five priority tiers PriorityBadge uses elsewhere (destructive /
// warning / muted / muted / success), just as solid color instead of a
// tinted badge, since these need to stay legible at a much smaller size
// packed into an hour-height cell.
function priorityBlockClasses(priority: number) {
  switch (priority) {
    case 1:
      return "bg-destructive text-white";
    case 2:
      return "bg-amber-500 text-white";
    case 3:
      return "bg-slate-500 text-white";
    case 4:
      return "bg-slate-400 text-white";
    default:
      return "bg-emerald-600 text-white";
  }
}

function priorityDotClasses(priority: number) {
  switch (priority) {
    case 1:
      return "bg-destructive";
    case 2:
      return "bg-amber-500";
    case 3:
      return "bg-slate-500";
    case 4:
      return "bg-slate-400";
    default:
      return "bg-emerald-600";
  }
}

export function CalendarClient({
  view,
  offset,
  blocks,
  atRisk,
  unscheduledTasks,
  projects,
}: {
  view: "week" | "month";
  offset: number;
  blocks: Block[];
  atRisk: TaskItem[];
  unscheduledTasks: TaskItem[];
  projects: Project[];
}) {
  const router = useRouter();
  const toast = useToast();
  const { t } = useLocale();
  // Scheduling/unscheduling calls a server action and waits for the
  // whole round trip (its own revalidatePath, PLUS now a debounced
  // Realtime refresh from the `tasks` write it makes - see
  // RealtimeRefresher) before the grid would otherwise show the move -
  // enough latency, and enough going on in that round trip, that a
  // dragged block could visibly render at its old position for a beat
  // before snapping to the new one, reading as "it reverts". Mirroring
  // `blocks` into local state and updating it immediately on
  // drop/click removes that wait entirely; the effect below just keeps
  // it in sync whenever the server's real data does arrive, which by
  // then should already match what was optimistically applied.
  const [localBlocks, setLocalBlocks] = useState(blocks);
  useEffect(() => {
    setLocalBlocks(blocks);
  }, [blocks]);

  const [showUnscheduled, setShowUnscheduled] = useState(true);
  const [hoveredSlot, setHoveredSlot] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{
    day: Date;
    hour: number;
  } | null>(null);
  // Click-to-arm alternative to drag-and-drop: arm a task, then click a
  // slot (week view) or day (month view) to schedule it there - HTML5
  // drag/drop doesn't work on touch, so this is the only way to
  // schedule from a phone/tablet, not just a nicety on desktop.
  const [armedTaskId, setArmedTaskId] = useState<string | null>(null);
  // Current-time indicator: computed client-side only, after mount, so
  // the server-rendered markup (built from the request's clock) never
  // has to match the browser's clock down to the second.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const today = now ?? new Date();
  const todayKey = today.toDateString();

  // The grid's hour rows were already rendered in the viewer's local
  // time (plain Date/getHours() math, nothing UTC about it) - the
  // corner label just said "GMT" unconditionally, which is only
  // accurate for viewers actually in that timezone. Computed from `now`
  // (client-only, see the effect above) so this never has to match a
  // server-rendered guess; Intl.DateTimeFormat with no explicit
  // timeZone defaults to the browser's own.
  const tzLabel = useMemo(() => {
    if (!now) return "";
    const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(now);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  }, [now]);

  const armedTask = useMemo(
    () => [...unscheduledTasks, ...atRisk].find((t) => t.id === armedTaskId) ?? null,
    [armedTaskId, unscheduledTasks, atRisk],
  );

  function toggleArmed(taskId: string) {
    setArmedTaskId((prev) => (prev === taskId ? null : taskId));
  }

  async function handleDrop(e: React.DragEvent, day: Date, hour: number) {
    e.preventDefault();
    setHoveredSlot(null);
    const taskId = e.dataTransfer.getData("taskId");
    if (!taskId) return;
    await scheduleAt(taskId, day, hour);
  }

  function handleDragStart(e: React.DragEvent, taskId: string) {
    e.dataTransfer.setData("taskId", taskId);
  }

  async function scheduleAt(taskId: string, day: Date, hour: number, durationMinutes = 60) {
    const startsAt = new Date(day);
    startsAt.setHours(hour, 0, 0, 0);
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);

    setLocalBlocks((prev) => {
      const existingIdx = prev.findIndex((b) => b.tasks?.id === taskId);
      if (existingIdx !== -1) {
        // Rescheduling an already-scheduled block - move it in place.
        const next = [...prev];
        next[existingIdx] = {
          ...next[existingIdx],
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
        };
        return next;
      }
      // Scheduling a not-yet-scheduled task for the first time - it
      // has no time_blocks row yet, so there's no real id to give it.
      // A temporary one is fine: the sync effect above replaces this
      // whole array with the server's real rows (real id included) on
      // the next refresh, same as it would for any other prop update.
      const task = [...unscheduledTasks, ...atRisk].find((t) => t.id === taskId);
      if (!task) return prev;
      return [
        ...prev,
        {
          id: `optimistic-${taskId}`,
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          tasks: { id: task.id, title: task.title, priority: task.priority },
        },
      ];
    });

    const result = await scheduleTaskBlock({
      taskId,
      startsAt: startsAt.toISOString(),
      durationMinutes,
    });
    if (!result.success) {
      // The optimistic move above was wrong - the write never actually
      // happened. Snap back to the last known-good server state (not
      // just "leave the wrong guess on screen") and say so.
      console.error("schedule failed:", result.error);
      setLocalBlocks(blocks);
      toast(friendlyError(result.error));
    }
  }

  async function handleUnschedule(blockId: string) {
    const previous = localBlocks;
    setLocalBlocks((prev) => prev.filter((b) => b.id !== blockId));
    const result = await unscheduleTaskBlock(blockId);
    if (!result.success) {
      console.error("unschedule failed:", result.error);
      setLocalBlocks(previous);
      toast(friendlyError(result.error));
    }
  }

  async function handleSlotClick(day: Date, hour: number) {
    if (armedTask) {
      await scheduleAt(armedTask.id, day, hour);
      setArmedTaskId(null);
      return;
    }
    setSelectedSlot({ day, hour });
  }

  async function handleMonthDayClick(day: Date, weekOffsetFromToday: number) {
    if (armedTask) {
      await scheduleAt(armedTask.id, day, 9);
      setArmedTaskId(null);
      return;
    }
    router.push(`/calendar?view=week&offset=${weekOffsetFromToday}`);
  }

  return (
    <div className="space-y-4">
      {/* Header Bar & Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">{t("calendar")}</h1>
          <p className="text-sm text-muted-foreground">
            {armedTask ? (
              <span className="flex items-center gap-1.5 font-medium text-primary">
                <Icon name="ads_click" size={14} />
                Click a {view === "week" ? "time slot" : "day"} to schedule &ldquo;{armedTask.title}&rdquo;
              </span>
            ) : (
              "Drag a task onto the grid, or click one then click a slot to schedule it."
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={showUnscheduled ? "default" : "outline"}
            size="sm"
            onClick={() => setShowUnscheduled((prev) => !prev)}
            className="gap-1.5 text-xs"
          >
            <Icon name="checklist" size={14} />
            {showUnscheduled ? "Hide Unscheduled" : `Unscheduled (${unscheduledTasks.length})`}
          </Button>

          <div className="flex items-center gap-0.5 rounded-lg border border-border/60 bg-muted/40 p-0.5">
            <Link href="/calendar?view=week&offset=0">
              <Button
                type="button"
                variant={view === "week" ? "default" : "ghost"}
                size="sm"
                className="text-xs"
              >
                Week
              </Button>
            </Link>
            <Link href="/calendar?view=month&offset=0">
              <Button
                type="button"
                variant={view === "month" ? "default" : "ghost"}
                size="sm"
                className="text-xs"
              >
                Month
              </Button>
            </Link>
          </div>

          <div className="flex items-center gap-1">
            <Link href={`/calendar?view=${view}&offset=${offset - 1}`}>
              <Button type="button" variant="outline" size="icon" aria-label={`Previous ${view}`}>
                <Icon name="chevron_left" size={16} />
              </Button>
            </Link>
            <Link href={`/calendar?view=${view}`}>
              <Button type="button" variant="outline" size="sm">
                Today
              </Button>
            </Link>
            <Link href={`/calendar?view=${view}&offset=${offset + 1}`}>
              <Button type="button" variant="outline" size="icon" aria-label={`Next ${view}`}>
                <Icon name="chevron_right" size={16} />
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* At Risk Alert Card */}
      {atRisk.length > 0 && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex flex-col gap-2 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <Icon name="warning" size={16} weight={500} />
              At Risk ({atRisk.length}) - Could not be scheduled before deadline
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {atRisk.map((task) => (
                <div
                  key={task.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, task.id)}
                  onClick={() => toggleArmed(task.id)}
                  className={cn(
                    "group flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-xs shadow-xs cursor-grab active:cursor-grabbing transition-all",
                    armedTaskId === task.id
                      ? "border-primary ring-2 ring-primary/40"
                      : "border-destructive/30 hover:border-destructive",
                  )}
                >
                  <Icon name="drag_indicator" size={14} className="text-muted-foreground group-hover:text-foreground" />
                  <span className="font-medium truncate max-w-[160px]">{task.title}</span>
                  <PriorityBadge priority={task.priority} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Grid & Side Panel Layout */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* Unscheduled Tasks Panel */}
        {showUnscheduled && (
          <Card className="w-full lg:w-72 shrink-0 border-border/60 shadow-xs animate-in fade-in slide-in-from-left-4 duration-200">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-border/40 pb-2.5">
                <h3 className="font-heading text-sm font-semibold flex items-center gap-2">
                  <Icon name="schedule" size={16} className="text-primary" />
                  Unscheduled Tasks
                </h3>
                <Badge variant="muted" className="text-xs">
                  {unscheduledTasks.length}
                </Badge>
              </div>

              <p className="text-[11px] text-muted-foreground">
                Drag a task onto the calendar, or click it then click a slot/day.
              </p>

              <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                {unscheduledTasks.length > 0 ? (
                  unscheduledTasks.map((task) => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, task.id)}
                      onClick={() => toggleArmed(task.id)}
                      className={cn(
                        "group flex items-center justify-between gap-2 rounded-lg border bg-card p-2.5 text-xs shadow-xs cursor-grab active:cursor-grabbing transition-all",
                        armedTaskId === task.id
                          ? "border-primary ring-2 ring-primary/40"
                          : "border-border/70 hover:border-primary/50 hover:shadow-md",
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Icon name="drag_indicator" size={14} className="text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-foreground truncate">{task.title}</p>
                          {task.projects && (
                            <span className="flex items-center gap-1 text-[10px] text-muted-foreground truncate">
                              <Icon name="folder" size={10} />
                              {task.projects.name}
                            </span>
                          )}
                        </div>
                      </div>
                      <PriorityBadge priority={task.priority} />
                    </div>
                  ))
                ) : (
                  <div className="py-6 text-center text-xs text-muted-foreground">
                    All tasks scheduled! Click any time slot to add a new task.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {view === "week" ? (
          <WeekGrid
            offset={offset}
            today={today}
            todayKey={todayKey}
            now={now}
            tzLabel={tzLabel}
            blocks={localBlocks}
            hoveredSlot={hoveredSlot}
            setHoveredSlot={setHoveredSlot}
            onDrop={handleDrop}
            onDragStart={handleDragStart}
            onSlotClick={handleSlotClick}
            onUnschedule={handleUnschedule}
            armed={Boolean(armedTask)}
          />
        ) : (
          <MonthGrid
            offset={offset}
            today={today}
            todayKey={todayKey}
            blocks={localBlocks}
            onDayClick={handleMonthDayClick}
            armed={Boolean(armedTask)}
          />
        )}
      </div>

      {/* Quick Task Creation Modal */}
      {selectedSlot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-xs p-4">
          <Card className="w-full max-w-md border-border bg-card shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-border/40 pb-3">
                <div>
                  <h3 className="font-heading text-base font-semibold flex items-center gap-2">
                    <Icon name="add" size={16} className="text-primary" />
                    Quick Schedule Task
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {selectedSlot.day.toLocaleDateString(undefined, {
                      weekday: "long",
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    at {selectedSlot.hour}:00
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedSlot(null)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Icon name="close" size={16} />
                </button>
              </div>

              <form
                action={async (formData) => {
                  try {
                    await createAndScheduleTask(formData);
                    setSelectedSlot(null);
                  } catch (err) {
                    // createAndScheduleTask throws rather than
                    // returning {success:false} - left uncaught, this
                    // would surface as a full-page crash (app/(app)/
                    // error.tsx) instead of a message on the still-open
                    // modal, for something as ordinary as a bad title.
                    console.error("create task failed:", err);
                    toast(friendlyError(err));
                  }
                }}
                className="space-y-3"
              >
                <input
                  type="hidden"
                  name="starts_at"
                  value={(() => {
                    const d = new Date(selectedSlot.day);
                    d.setHours(selectedSlot.hour, 0, 0, 0);
                    return d.toISOString();
                  })()}
                />

                <div className="space-y-1">
                  <Label htmlFor="title" className="text-xs">Task Title</Label>
                  <Input id="title" name="title" placeholder="e.g. Design review meeting" required />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="priority" className="text-xs">Priority</Label>
                    <Select id="priority" name="priority" defaultValue="3">
                      <option value="1">P1 · Highest</option>
                      <option value="2">P2 · High</option>
                      <option value="3">P3 · Medium</option>
                      <option value="4">P4 · Low</option>
                      <option value="5">P5 · Lowest</option>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="duration" className="text-xs">Duration</Label>
                    <Select id="duration" name="duration" defaultValue="60">
                      <option value="30">30 mins</option>
                      <option value="60">1 hour</option>
                      <option value="90">1.5 hours</option>
                      <option value="120">2 hours</option>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="project_id" className="text-xs">Project</Label>
                  <Select id="project_id" name="project_id" defaultValue="">
                    <option value="">No project</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setSelectedSlot(null)}
                  >
                    Cancel
                  </Button>
                  <SubmitButton pendingText="Scheduling...">{t("scheduleTask")}</SubmitButton>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function WeekGrid({
  offset,
  today,
  todayKey,
  now,
  tzLabel,
  blocks,
  hoveredSlot,
  setHoveredSlot,
  onDrop,
  onDragStart,
  onSlotClick,
  onUnschedule,
  armed,
}: {
  offset: number;
  today: Date;
  todayKey: string;
  now: Date | null;
  tzLabel: string;
  blocks: Block[];
  hoveredSlot: string | null;
  setHoveredSlot: (key: string | null) => void;
  onDrop: (e: React.DragEvent, day: Date, hour: number) => void;
  onDragStart: (e: React.DragEvent, taskId: string) => void;
  onSlotClick: (day: Date, hour: number) => void;
  onUnschedule: (blockId: string) => void;
  armed: boolean;
}) {
  const weekStart = startOfWeek(today);
  weekStart.setTime(weekStart.getTime() + offset * 7 * DAY_MS);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setTime(d.getTime() + i * DAY_MS);
    return d;
  });

  const blocksByDay = days.map((day) =>
    blocks.filter((b) => new Date(b.starts_at).toDateString() === day.toDateString()),
  );
  const layoutByDay = blocksByDay.map(layoutDayBlocks);
  // Which overlap cluster's full task list is open in the dialog below -
  // see MAX_VISIBLE_LANES's comment for why a cluster needs one at all.
  const [overflowGroup, setOverflowGroup] = useState<Block[] | null>(null);

  const nowInRange =
    now && now.getHours() >= START_HOUR && now.getHours() < END_HOUR
      ? ((now.getHours() - START_HOUR) * 60 + now.getMinutes()) / 60 * HOUR_HEIGHT
      : null;
  const todayColumnIndex = days.findIndex((d) => d.toDateString() === todayKey);

  return (
    <div className="flex-1 min-w-0 w-full overflow-x-auto rounded-xl border border-border/60 bg-card shadow-xs">
      <div className="grid min-w-[720px] grid-cols-[56px_repeat(7,1fr)]">
        <div
          className="border-b border-border/60 p-2 text-center text-[10px] font-mono text-muted-foreground"
          title="Times shown in your device's local timezone"
        >
          {tzLabel || " "}
        </div>

        {days.map((day) => {
          const isToday = day.toDateString() === todayKey;
          return (
            <div
              key={day.toISOString()}
              className={cn(
                "border-l border-b border-border/60 px-2 py-2.5 text-center",
                isToday && "bg-primary/10",
              )}
            >
              <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                {day.toLocaleDateString(undefined, { weekday: "short" })}
              </p>
              <p
                className={cn(
                  "font-heading text-base",
                  isToday ? "font-bold text-primary" : "font-semibold",
                )}
              >
                {day.getDate()}
              </p>
            </div>
          );
        })}

        <div className="relative" style={{ height: (END_HOUR - START_HOUR) * HOUR_HEIGHT }}>
          {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
            <div
              key={i}
              className="absolute right-2 -translate-y-1/2 text-[11px] font-mono text-muted-foreground"
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
              style={{ height: (END_HOUR - START_HOUR) * HOUR_HEIGHT }}
            >
              {Array.from({ length: END_HOUR - START_HOUR }, (_, h) => {
                const hour = START_HOUR + h;
                const slotKey = `${day.toISOString()}-${hour}`;
                const isHovered = hoveredSlot === slotKey;

                return (
                  <div
                    key={h}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setHoveredSlot(slotKey);
                    }}
                    onDragLeave={() => setHoveredSlot(null)}
                    onDrop={(e) => onDrop(e, day, hour)}
                    onClick={() => onSlotClick(day, hour)}
                    className={cn(
                      "group absolute w-full border-t border-border/40 transition-colors cursor-pointer",
                      isHovered ? "bg-primary/20 border-primary/60" : "hover:bg-muted/40",
                    )}
                    style={{ top: h * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                  >
                    <div className="opacity-0 group-hover:opacity-100 flex items-center justify-end px-2 pt-1 transition-opacity">
                      <span className="flex items-center gap-1 text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                        <Icon name={armed ? "ads_click" : "add"} size={12} />
                        {armed ? "Schedule here" : "Add Task"}
                      </span>
                    </div>
                  </div>
                );
              })}

              {isToday && nowInRange !== null && i === todayColumnIndex && (
                <div
                  className="absolute right-0 left-0 z-20 flex items-center pointer-events-none"
                  style={{ top: nowInRange }}
                >
                  <span className="-ml-1 size-2 rounded-full bg-destructive" />
                  <span className="h-px flex-1 bg-destructive" />
                </div>
              )}

              {layoutByDay[i].clusters.flatMap((cluster) => {
                const scheduledCluster = cluster.filter((b) => b.tasks);
                if (!scheduledCluster.length) return [];
                const laneCount = layoutByDay[i].lanes.get(scheduledCluster[0].id)?.laneCount ?? 1;
                const isCapped = laneCount > MAX_VISIBLE_LANES;
                const overflowLane = MAX_VISIBLE_LANES - 1;
                const visibleDenominator = isCapped ? MAX_VISIBLE_LANES : laneCount;

                const nodes: React.ReactNode[] = [];
                const hidden: Block[] = [];

                for (const block of scheduledCluster) {
                  const { lane } = layoutByDay[i].lanes.get(block.id)!;
                  if (isCapped && lane >= overflowLane) {
                    hidden.push(block);
                    continue;
                  }

                  const top = Math.max(0, (offsetMinutes(day, block.starts_at) / 60) * HOUR_HEIGHT);
                  const height = Math.max(
                    MIN_BLOCK_HEIGHT,
                    ((new Date(block.ends_at).getTime() - new Date(block.starts_at).getTime()) /
                      60_000 /
                      60) *
                      HOUR_HEIGHT,
                  );
                  const leftPct = (lane / visibleDenominator) * 100;
                  const widthPct = 100 / visibleDenominator;
                  // Below this a title + time line don't both fit -
                  // just the (still full-size, still tappable) title.
                  const showTimeLine = height >= 46;

                  nodes.push(
                    <div
                      key={block.id}
                      draggable
                      onDragStart={(e) => onDragStart(e, block.tasks!.id)}
                      className={cn(
                        "group absolute z-10 flex flex-col justify-center gap-0.5 overflow-hidden rounded-lg py-1.5 pr-6 pl-2.5 text-xs font-semibold cursor-grab active:cursor-grabbing shadow-xs transition-all hover:opacity-90",
                        priorityBlockClasses(block.tasks!.priority),
                      )}
                      style={{
                        top,
                        height,
                        left: `calc(${leftPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                      }}
                    >
                      <Link
                        href={`/tasks/${block.tasks!.id}`}
                        className="truncate leading-tight hover:underline text-inherit"
                      >
                        {block.tasks!.title}
                      </Link>
                      {showTimeLine && (
                        <span className="truncate text-[10px] font-normal leading-tight text-white/80">
                          {formatTime(block.starts_at)} - {formatTime(block.ends_at)}
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onUnschedule(block.id);
                        }}
                        // Always faintly visible (not hover-only) - a
                        // hover-only affordance is undiscoverable and
                        // untappable on touch, where there's no hover
                        // state to reveal it in the first place.
                        className="absolute top-1 right-1 rounded p-0.5 text-white/70 opacity-70 transition-all hover:bg-black/25 hover:text-white hover:opacity-100 group-hover:opacity-100"
                        title="Unschedule"
                      >
                        <Icon name="close" size={13} />
                      </button>
                    </div>,
                  );
                }

                if (hidden.length) {
                  const starts = hidden.map((b) => offsetMinutes(day, b.starts_at));
                  const ends = hidden.map((b) => offsetMinutes(day, b.ends_at));
                  const top = Math.max(0, (Math.min(...starts) / 60) * HOUR_HEIGHT);
                  const height = Math.max(MIN_BLOCK_HEIGHT, ((Math.max(...ends) - Math.min(...starts)) / 60) * HOUR_HEIGHT);
                  const leftPct = (overflowLane / visibleDenominator) * 100;
                  const widthPct = 100 / visibleDenominator;

                  nodes.push(
                    <button
                      key={`overflow-${scheduledCluster[0].id}`}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOverflowGroup(scheduledCluster);
                      }}
                      className="group absolute z-10 flex items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted px-1 text-[10px] font-semibold text-muted-foreground shadow-xs transition-all hover:bg-muted/70"
                      style={{
                        top,
                        height,
                        left: `calc(${leftPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                      }}
                      title={`${hidden.length} more task${hidden.length === 1 ? "" : "s"} at this time - click to see all ${scheduledCluster.length}`}
                    >
                      +{hidden.length}
                    </button>,
                  );
                }

                return nodes;
              })}
            </div>
          );
        })}
      </div>

      {/* Overlap Overflow Dialog - see MAX_VISIBLE_LANES */}
      {overflowGroup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-xs p-4"
          onClick={() => setOverflowGroup(null)}
        >
          <Card
            className="w-full max-w-sm border-border bg-card shadow-2xl animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-border/40 pb-3">
                <h3 className="font-heading text-base font-semibold flex items-center gap-2">
                  <Icon name="event_busy" size={16} className="text-primary" />
                  {overflowGroup.length} tasks at this time
                </h3>
                <button
                  type="button"
                  onClick={() => setOverflowGroup(null)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {overflowGroup.map(
                  (block) =>
                    block.tasks && (
                      <div
                        key={block.id}
                        className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 p-2.5 text-xs"
                      >
                        <span
                          className={cn("size-2 shrink-0 rounded-full", priorityDotClasses(block.tasks.priority))}
                        />
                        <Link
                          href={`/tasks/${block.tasks.id}`}
                          className="min-w-0 flex-1 truncate font-medium hover:underline"
                          onClick={() => setOverflowGroup(null)}
                        >
                          {block.tasks.title}
                        </Link>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {new Date(block.starts_at).toLocaleTimeString(undefined, {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            onUnschedule(block.id);
                            setOverflowGroup((prev) => (prev ? prev.filter((b) => b.id !== block.id) : prev));
                          }}
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                          title="Unschedule"
                        >
                          <Icon name="close" size={14} />
                        </button>
                      </div>
                    ),
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function MonthGrid({
  offset,
  today,
  todayKey,
  blocks,
  onDayClick,
  armed,
}: {
  offset: number;
  today: Date;
  todayKey: string;
  blocks: Block[];
  onDayClick: (day: Date, weekOffsetFromToday: number) => void;
  armed: boolean;
}) {
  const monthStart = startOfMonth(today, offset);
  const gridStart = startOfWeek(monthStart);
  const thisWeekStart = startOfWeek(today);

  const days = Array.from({ length: MONTH_CELLS }, (_, i) => {
    const d = new Date(gridStart);
    d.setTime(d.getTime() + i * DAY_MS);
    return d;
  });

  const blocksByDayKey = new Map<string, Block[]>();
  for (const block of blocks) {
    const key = new Date(block.starts_at).toDateString();
    const list = blocksByDayKey.get(key);
    if (list) list.push(block);
    else blocksByDayKey.set(key, [block]);
  }

  return (
    <div className="flex-1 min-w-0 w-full overflow-x-auto rounded-xl border border-border/60 bg-card shadow-xs">
      <div className="grid min-w-[720px] grid-cols-7">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
          <div
            key={label}
            className="border-b border-border/60 px-2 py-2 text-center text-[11px] font-semibold tracking-wider text-muted-foreground uppercase"
          >
            {label}
          </div>
        ))}

        {days.map((day, i) => {
          const isToday = day.toDateString() === todayKey;
          const isCurrentMonth = day.getMonth() === monthStart.getMonth();
          const dayBlocks = (blocksByDayKey.get(day.toDateString()) ?? [])
            .filter((b) => b.tasks)
            .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
          const weekOffsetFromToday = Math.round(
            (startOfWeek(day).getTime() - thisWeekStart.getTime()) / (7 * DAY_MS),
          );

          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onDayClick(day, weekOffsetFromToday)}
              className={cn(
                "flex min-h-[104px] flex-col items-stretch gap-1 border-b border-l p-1.5 text-left transition-colors",
                (i + 1) % 7 === 0 ? "" : "border-r-0",
                "border-border/60",
                isCurrentMonth ? "bg-card" : "bg-muted/20",
                armed ? "hover:bg-primary/10 cursor-pointer" : "hover:bg-muted/40 cursor-pointer",
              )}
            >
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-xs font-semibold",
                  isToday
                    ? "bg-primary text-primary-foreground"
                    : isCurrentMonth
                    ? "text-foreground"
                    : "text-muted-foreground/50",
                )}
              >
                {day.getDate()}
              </span>

              <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
                {dayBlocks.slice(0, 3).map((block) => (
                  <span
                    key={block.id}
                    className="flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] font-medium text-foreground/90"
                  >
                    <span className={cn("size-1.5 shrink-0 rounded-full", priorityDotClasses(block.tasks!.priority))} />
                    <span className="truncate">{block.tasks!.title}</span>
                  </span>
                ))}
                {dayBlocks.length > 3 && (
                  <span className="px-1 text-[10px] text-muted-foreground">
                    +{dayBlocks.length - 3} more
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
