import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  CheckSquare,
  Square,
  Sparkles,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteButton } from "@/components/delete-button";
import {
  updateTask,
  deleteTask,
  clearTaskSchedule,
  toggleTaskDone,
} from "../actions";

// Renders in the server's local timezone (TZ in .env), matching how
// updateTask/createTask parse the same "datetime-local" string back via
// `new Date(value)` server-side - same interpretation both directions.
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATUS_VARIANT: Record<
  string,
  "default" | "muted" | "warning" | "success" | "destructive"
> = {
  open: "muted",
  scheduled: "default", // primary badge for "on the calendar"
  in_progress: "warning",
  done: "success",
  at_risk: "destructive",
  canceled: "muted",
};

export default async function TaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: task }, { data: projects }, { data: timeBlock }] =
    await Promise.all([
      supabase
        .from("tasks")
        .select(
          "id, title, context, status, priority, energy_level, estimated_minutes, deadline, project_id, capture_id, created_at",
        )
        .eq("id", id)
        .single(),
      supabase.from("projects").select("id, name").order("name"),
      supabase
        .from("time_blocks")
        .select("starts_at, ends_at")
        .eq("task_id", id)
        .eq("status", "scheduled")
        .maybeSingle(),
    ]);

  if (!task) {
    notFound();
  }

  const done = task.status === "done";

  return (
    <article className="max-w-xl space-y-4">
      <Link
        href="/tasks"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" strokeWidth={1.75} />
        Back to Tasks
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <form action={toggleTaskDone} className="pt-1">
            <input type="hidden" name="id" value={task.id} />
            <input type="hidden" name="was_done" value={String(done)} />
            <button
              type="submit"
              className="text-muted-foreground hover:text-foreground"
              aria-label={done ? "Mark open" : "Mark done"}
            >
              {done ? (
                <CheckSquare className="size-5" strokeWidth={1.75} />
              ) : (
                <Square className="size-5" strokeWidth={1.75} />
              )}
            </button>
          </form>
          <div>
            <h1
              className={`font-heading text-xl font-semibold ${done ? "text-muted-foreground line-through" : ""}`}
            >
              {task.title}
            </h1>
            {task.capture_id && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Sparkles className="size-3" strokeWidth={1.75} />
                Generated from a capture
              </p>
            )}
          </div>
        </div>
        <Badge variant={STATUS_VARIANT[task.status] ?? "muted"}>
          {task.status}
        </Badge>
      </div>

      <form action={updateTask} className="space-y-4">
        <input type="hidden" name="id" value={task.id} />

        <Card>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="title">Title</Label>
              <Input id="title" name="title" defaultValue={task.title} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="context">Notes</Label>
              <Textarea
                id="context"
                name="context"
                defaultValue={task.context ?? ""}
                rows={4}
                placeholder="Context, links, anything else..."
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="priority">Priority</Label>
              <Select
                id="priority"
                name="priority"
                defaultValue={String(task.priority)}
              >
                <option value="1">P1 · Highest</option>
                <option value="2">P2 · High</option>
                <option value="3">P3 · Medium</option>
                <option value="4">P4 · Low</option>
                <option value="5">P5 · Lowest</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="deadline">Deadline</Label>
              <Input
                id="deadline"
                name="deadline"
                type="date"
                defaultValue={task.deadline ? task.deadline.slice(0, 10) : ""}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="energy_level">Energy level</Label>
              <Select
                id="energy_level"
                name="energy_level"
                defaultValue={task.energy_level}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="estimated_minutes">Duration (minutes)</Label>
              <Input
                id="estimated_minutes"
                name="estimated_minutes"
                type="number"
                min={5}
                step={5}
                defaultValue={task.estimated_minutes}
              />
            </div>
            <div className="col-span-2 space-y-1">
              <Label htmlFor="project_id">Project</Label>
              <Select
                id="project_id"
                name="project_id"
                defaultValue={task.project_id ?? ""}
              >
                <option value="">No project</option>
                {projects?.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className={timeBlock ? "border-primary/30" : undefined}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <CalendarClock className="size-4 text-primary" strokeWidth={1.75} />
              Schedule
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input id="scheduled_at" name="scheduled_at" type="datetime-local"
              defaultValue={timeBlock ? toDatetimeLocalValue(timeBlock.starts_at) : ""}
            />
            <p className="text-xs text-muted-foreground">
              {timeBlock
                ? "Set manually - won't be moved by the automatic scheduler unless cleared."
                : "Leave blank to let the scheduler place it automatically, based on priority, deadline, and your working hours."}
            </p>
            {timeBlock && (
              <p className="text-sm font-medium text-primary">
                On the calendar: {new Date(timeBlock.starts_at).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                {" - "}
                {new Date(timeBlock.ends_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </p>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <Button type="submit">Save changes</Button>
          {timeBlock && (
            <Button type="submit" formAction={clearTaskSchedule} variant="outline" size="sm">
              Clear schedule
            </Button>
          )}
        </div>
      </form>

      <DeleteButton
        action={deleteTask}
        id={task.id}
        confirmMessage={`Delete "${task.title}"?`}
        label="Delete task"
        variant="button"
      />
    </article>
  );
}
