"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  AlertTriangle,
  GripVertical,
  Calendar as CalendarIcon,
  X,
  Clock,
  Folder,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { PriorityBadge } from "@/components/priority-badge";
import {
  scheduleTaskBlock,
  createAndScheduleTask,
  unscheduleTaskBlock,
} from "./calendar-actions";

const START_HOUR = 7;
const END_HOUR = 21;
const HOUR_HEIGHT = 52; // px
const DAY_MS = 86_400_000;

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

function offsetMinutes(dayStart: Date, iso: string) {
  const d = new Date(iso);
  return (d.getTime() - dayStart.getTime()) / 60_000 - START_HOUR * 60;
}

export function CalendarClient({
  offset,
  blocks,
  atRisk,
  unscheduledTasks,
  projects,
}: {
  offset: number;
  blocks: Block[];
  atRisk: TaskItem[];
  unscheduledTasks: TaskItem[];
  projects: Project[];
}) {
  const [showUnscheduled, setShowUnscheduled] = useState(true);
  const [hoveredSlot, setHoveredSlot] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{
    day: Date;
    hour: number;
  } | null>(null);

  const now = new Date();
  const weekStart = startOfWeek(now);
  weekStart.setTime(weekStart.getTime() + offset * 7 * DAY_MS);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setTime(d.getTime() + i * DAY_MS);
    return d;
  });

  const todayKey = now.toDateString();

  const blocksByDay = days.map((day) =>
    blocks.filter(
      (b) => new Date(b.starts_at).toDateString() === day.toDateString(),
    ),
  );

  async function handleDrop(e: React.DragEvent, day: Date, hour: number) {
    e.preventDefault();
    setHoveredSlot(null);

    const taskId = e.dataTransfer.getData("taskId");
    if (!taskId) return;

    const startsAt = new Date(day);
    startsAt.setHours(hour, 0, 0, 0);

    await scheduleTaskBlock({
      taskId,
      startsAt: startsAt.toISOString(),
      durationMinutes: 60,
    });
  }

  function handleDragStart(e: React.DragEvent, taskId: string) {
    e.dataTransfer.setData("taskId", taskId);
  }

  return (
    <div className="space-y-4">
      {/* Header Bar & Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Calendar</h1>
          <p className="text-sm text-muted-foreground">
            Drag unscheduled tasks onto the grid or click any time slot to quickly schedule.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={showUnscheduled ? "default" : "outline"}
            size="sm"
            onClick={() => setShowUnscheduled((prev) => !prev)}
            className="gap-1.5 text-xs"
          >
            <CalendarIcon className="size-3.5" />
            {showUnscheduled ? "Hide Unscheduled" : `Unscheduled (${unscheduledTasks.length})`}
          </Button>

          <div className="flex items-center gap-1">
            <Link href={`/calendar?offset=${offset - 1}`}>
              <Button type="button" variant="outline" size="icon" aria-label="Previous week">
                <ChevronLeft className="size-4" strokeWidth={1.75} />
              </Button>
            </Link>
            <Link href="/calendar">
              <Button type="button" variant="outline" size="sm">
                Today
              </Button>
            </Link>
            <Link href={`/calendar?offset=${offset + 1}`}>
              <Button type="button" variant="outline" size="icon" aria-label="Next week">
                <ChevronRight className="size-4" strokeWidth={1.75} />
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
              <AlertTriangle className="size-4" strokeWidth={2} />
              At Risk ({atRisk.length}) - Could not be scheduled before deadline
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {atRisk.map((task) => (
                <div
                  key={task.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, task.id)}
                  className="group flex items-center gap-2 rounded-md border border-destructive/30 bg-card px-2.5 py-1.5 text-xs shadow-xs cursor-grab active:cursor-grabbing hover:border-destructive transition-all"
                >
                  <GripVertical className="size-3.5 text-muted-foreground group-hover:text-foreground" />
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
                  <Clock className="size-4 text-primary" />
                  Unscheduled Tasks
                </h3>
                <Badge variant="muted" className="text-xs">
                  {unscheduledTasks.length}
                </Badge>
              </div>

              <p className="text-[11px] text-muted-foreground">
                Drag any task below onto a day/time slot on the calendar.
              </p>

              <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                {unscheduledTasks.length > 0 ? (
                  unscheduledTasks.map((task) => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, task.id)}
                      className="group flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-card p-2.5 text-xs shadow-xs cursor-grab active:cursor-grabbing hover:border-primary/50 hover:shadow-md transition-all"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <GripVertical className="size-3.5 text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-foreground truncate">{task.title}</p>
                          {task.projects && (
                            <span className="flex items-center gap-1 text-[10px] text-muted-foreground truncate">
                              <Folder className="size-2.5 shrink-0" />
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

        {/* 7-Day Calendar Grid */}
        <div className="flex-1 min-w-0 w-full overflow-x-auto rounded-xl border border-border/60 bg-card shadow-xs">
          <div className="grid min-w-[720px] grid-cols-[56px_repeat(7,1fr)]">
            {/* Header empty top-left cell */}
            <div className="border-b border-border/60 p-2 text-center text-[10px] font-mono text-muted-foreground">
              GMT
            </div>

            {/* Day Header Columns */}
            {days.map((day) => {
              const isToday = day.toDateString() === todayKey;
              return (
                <div
                  key={day.toISOString()}
                  className={`border-l border-b border-border/60 px-2 py-2.5 text-center ${
                    isToday ? "bg-primary/10" : ""
                  }`}
                >
                  <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    {day.toLocaleDateString(undefined, { weekday: "short" })}
                  </p>
                  <p
                    className={`font-heading text-base ${
                      isToday ? "font-bold text-primary" : "font-semibold"
                    }`}
                  >
                    {day.getDate()}
                  </p>
                </div>
              );
            })}

            {/* Time Labels Sidebar */}
            <div className="relative" style={{ height: (END_HOUR - START_HOUR) * HOUR_HEIGHT }}>
              {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
                <div
                  key={i}
                  className="absolute right-2 -translate-y-1/2 text-[10px] font-mono text-muted-foreground"
                  style={{ top: i * HOUR_HEIGHT }}
                >
                  {((START_HOUR + i + 11) % 12) + 1}
                  {START_HOUR + i < 12 ? "am" : "pm"}
                </div>
              ))}
            </div>

            {/* Day Columns with Hour Drop Cells */}
            {days.map((day, i) => {
              const isToday = day.toDateString() === todayKey;
              return (
                <div
                  key={day.toISOString()}
                  className="relative border-l border-border/60"
                  style={{ height: (END_HOUR - START_HOUR) * HOUR_HEIGHT }}
                >
                  {/* Hour Rows */}
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
                        onDrop={(e) => handleDrop(e, day, hour)}
                        onClick={() => setSelectedSlot({ day, hour })}
                        className={`group absolute w-full border-t border-border/40 transition-colors cursor-pointer ${
                          isHovered
                            ? "bg-primary/20 border-primary/60"
                            : "hover:bg-muted/40"
                        }`}
                        style={{ top: h * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                      >
                        {/* Plus button indicator on hover */}
                        <div className="opacity-0 group-hover:opacity-100 flex items-center justify-end px-2 pt-1 transition-opacity">
                          <span className="flex items-center gap-1 text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                            <Plus className="size-3" /> Add Task
                          </span>
                        </div>
                      </div>
                    );
                  })}

                  {/* Scheduled Block Cards */}
                  {blocksByDay[i].map((block) => {
                    if (!block.tasks) return null;
                    const top = Math.max(
                      0,
                      (offsetMinutes(day, block.starts_at) / 60) * HOUR_HEIGHT,
                    );
                    const height = Math.max(
                      24,
                      ((new Date(block.ends_at).getTime() -
                        new Date(block.starts_at).getTime()) /
                        60_000 /
                        60) *
                        HOUR_HEIGHT,
                    );

                    return (
                      <div
                        key={block.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, block.tasks!.id)}
                        className="group absolute right-1 left-1 z-10 flex items-center justify-between overflow-hidden rounded-md border border-primary/30 bg-primary/15 px-2 py-1 text-xs text-primary shadow-xs cursor-grab active:cursor-grabbing hover:bg-primary/25 transition-colors"
                        style={{ top, height }}
                      >
                        <Link
                          href={`/tasks/${block.tasks.id}`}
                          className="font-medium truncate flex-1 hover:underline"
                        >
                          {block.tasks.title}
                        </Link>

                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            await unscheduleTaskBlock(block.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 text-primary/70 hover:text-destructive p-0.5 transition-all"
                          title="Unschedule"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Quick Task Creation Modal */}
      {selectedSlot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-xs p-4">
          <Card className="w-full max-w-md border-border bg-card shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-border/40 pb-3">
                <div>
                  <h3 className="font-heading text-base font-semibold flex items-center gap-2">
                    <Plus className="size-4 text-primary" />
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
                  <X className="size-4" />
                </button>
              </div>

              <form
                action={async (formData) => {
                  await createAndScheduleTask(formData);
                  setSelectedSlot(null);
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
                    <Select id="priority" name="priority" defaultValue="2">
                      <option value="1">P1 (Urgent)</option>
                      <option value="2">P2 (Normal)</option>
                      <option value="3">P3 (Low)</option>
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
                  <Button type="submit">Schedule Task</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
