import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { createClient } from "@/lib/supabase/server";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteButton } from "@/components/delete-button";
import { SubmitButton } from "@/components/submit-button";
import { FormSubmitButton } from "@/components/form-submit-button";
import { Trans } from "@/components/trans";
import {
  updateTask,
  deleteTask,
  clearTaskSchedule,
  toggleTaskDone,
  addTaskDependency,
  removeTaskDependency,
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
  const [
    { data: task },
    { data: projects },
    { data: timeBlock },
    { data: blockedByRows },
    { data: blocksRows },
    { data: candidateTasks },
  ] = await Promise.all([
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
    // task_dependencies has two foreign keys into tasks (task_id and
    // depends_on_task_id), which PostgREST can't auto-embed through
    // without disambiguating hints - plain id pairs here, titles/status
    // resolved via a separate lookup below instead of risking the wrong
    // embed syntax (see the Dashboard's relationships fix for the same
    // lesson learned the hard way).
    supabase.from("task_dependencies").select("depends_on_task_id").eq("task_id", id),
    supabase.from("task_dependencies").select("task_id").eq("depends_on_task_id", id),
    supabase.from("tasks").select("id, title, status").neq("id", id).order("title"),
  ]);

  if (!task) {
    notFound();
  }

  const blockedByIds = (blockedByRows ?? []).map((r) => r.depends_on_task_id);
  const blocksIds = (blocksRows ?? []).map((r) => r.task_id);
  const relatedIds = [...new Set([...blockedByIds, ...blocksIds])];
  const { data: relatedTasks } = relatedIds.length
    ? await supabase.from("tasks").select("id, title, status").in("id", relatedIds)
    : { data: [] as { id: string; title: string; status: string }[] };
  const relatedById = new Map((relatedTasks ?? []).map((t) => [t.id, t]));
  const blockedBy = blockedByIds.map((tid) => relatedById.get(tid)).filter(Boolean) as {
    id: string;
    title: string;
    status: string;
  }[];
  const blocks = blocksIds.map((tid) => relatedById.get(tid)).filter(Boolean) as {
    id: string;
    title: string;
    status: string;
  }[];
  const isBlocked = blockedBy.some((t) => t.status !== "done");
  const dependencyCandidates = (candidateTasks ?? []).filter(
    (t) => !blockedByIds.includes(t.id),
  );

  const done = task.status === "done";

  return (
    <article className="mx-auto max-w-xl space-y-4">
      <Link
        href="/tasks"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <Icon name="arrow_back" size={14} />
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
              <Icon name={done ? "check_box" : "check_box_outline_blank"} size={20} />
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
                <Icon name="auto_awesome" size={12} />
                Generated from a capture
              </p>
            )}
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          {isBlocked && (
            <Badge variant="destructive" className="gap-1">
              <Icon name="link" size={11} />
              Blocked
            </Badge>
          )}
          <Badge variant={STATUS_VARIANT[task.status] ?? "muted"}>
            {task.status}
          </Badge>
        </span>
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
              <Icon name="event" size={16} className="text-primary" />
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
          <SubmitButton pendingText="Saving..."><Trans id="saveChanges" /></SubmitButton>
          {timeBlock && (
            <SubmitButton formAction={clearTaskSchedule} variant="outline" size="sm" pendingText="Clearing...">
              Clear schedule
            </SubmitButton>
          )}
        </div>
      </form>

      <Card className={isBlocked ? "border-destructive/30" : undefined}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Icon name="link" size={16} className={isBlocked ? "text-destructive" : undefined} />
            Dependencies
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Blocked by
            </p>
            {isBlocked && (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <Icon name="warning" size={12} />
                Won&apos;t be scheduled until the tasks below are done.
              </p>
            )}
            {blockedBy.length ? (
              <ul className="space-y-1">
                {blockedBy.map((t) => (
                  <li key={t.id} className="flex items-center gap-2">
                    <Icon
                      name={t.status === "done" ? "check_box" : "check_box_outline_blank"}
                      size={14}
                      className="shrink-0 text-muted-foreground"
                    />
                    <Link href={`/tasks/${t.id}`} className="flex-1 truncate text-sm hover:underline">
                      {t.title}
                    </Link>
                    <form action={removeTaskDependency}>
                      <input type="hidden" name="task_id" value={task.id} />
                      <input type="hidden" name="depends_on_task_id" value={t.id} />
                      <FormSubmitButton
                        aria-label={`Remove dependency on ${t.title}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Icon name="close" size={14} />
                      </FormSubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground italic">Nothing blocking this task.</p>
            )}
            {dependencyCandidates.length > 0 && (
              <form action={addTaskDependency} className="flex gap-2 pt-1">
                <input type="hidden" name="task_id" value={task.id} />
                <Select name="depends_on_task_id" className="flex-1" defaultValue="">
                  <option value="" disabled>
                    Add a dependency...
                  </option>
                  {dependencyCandidates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </Select>
                <SubmitButton size="sm" variant="outline" pendingText="Adding...">
                  Add
                </SubmitButton>
              </form>
            )}
          </div>

          {blocks.length > 0 && (
            <div className="space-y-1.5 border-t border-border/40 pt-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Blocks
              </p>
              <ul className="space-y-1">
                {blocks.map((t) => (
                  <li key={t.id} className="flex items-center gap-2">
                    <Icon
                      name={t.status === "done" ? "check_box" : "check_box_outline_blank"}
                      size={14}
                      className="shrink-0 text-muted-foreground"
                    />
                    <Link href={`/tasks/${t.id}`} className="flex-1 truncate text-sm hover:underline">
                      {t.title}
                    </Link>
                    <form action={removeTaskDependency}>
                      <input type="hidden" name="task_id" value={t.id} />
                      <input type="hidden" name="depends_on_task_id" value={task.id} />
                      <FormSubmitButton
                        aria-label={`Remove ${task.title} as a dependency of ${t.title}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Icon name="close" size={14} />
                      </FormSubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

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
