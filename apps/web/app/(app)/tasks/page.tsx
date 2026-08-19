import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { Trans } from "@/components/trans";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { DeleteButton } from "@/components/delete-button";
import { PriorityBadge } from "@/components/priority-badge";
import { createTask, toggleTaskDone, deleteTask } from "./actions";

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "done", label: "Done" },
] as const;

const SORTS = [
  { value: "priority", label: "Priority" },
  { value: "deadline", label: "Deadline" },
  { value: "newest", label: "Newest" },
] as const;

function isOverdue(deadline: string | null, status: string) {
  return Boolean(deadline) && status !== "done" && new Date(deadline!) < new Date();
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; sort?: string }>;
}) {
  const { status = "all", sort = "priority" } = await searchParams;
  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .order("name");

  let query = supabase
    .from("tasks")
    .select("id, title, status, priority, deadline, projects(id, name)");

  if (status === "open") query = query.eq("status", "open");
  if (status === "done") query = query.eq("status", "done");

  if (sort === "deadline") {
    query = query.order("deadline", { ascending: true, nullsFirst: false });
  } else if (sort === "newest") {
    query = query.order("created_at", { ascending: false });
  } else {
    query = query
      .order("priority", { ascending: true })
      .order("deadline", { ascending: true, nullsFirst: false });
  }

  const { data: tasks } = await query;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold"><Trans id="tasks" /></h1>
        <p className="text-sm text-muted-foreground">
          What needs to get done.
        </p>
      </div>

      <form action={createTask} className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
        <Input
          name="title"
          placeholder="Add a task..."
          required
          className="w-full sm:min-w-48 sm:flex-1"
        />
        <Select name="priority" defaultValue="3" className="w-full sm:w-36">
          <option value="1">P1 · Highest</option>
          <option value="2">P2 · High</option>
          <option value="3">P3 · Medium</option>
          <option value="4">P4 · Low</option>
          <option value="5">P5 · Lowest</option>
        </Select>
        <Input name="deadline" type="date" className="w-full sm:w-40" />
        <Select name="project_id" defaultValue="" className="w-full sm:w-40">
          <option value="">No project</option>
          {projects?.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
        <Input
          name="estimated_minutes"
          type="number"
          min={5}
          step={5}
          defaultValue={30}
          title="Duration (minutes)"
          className="w-full sm:w-24"
        />
        <Input
          name="scheduled_at"
          type="datetime-local"
          title="Schedule at a specific time (optional) - leave blank to let the scheduler place it automatically"
          className="w-full sm:w-52"
        />
        <SubmitButton className="w-full sm:w-auto" pendingText="Adding..."><Trans id="add" /></SubmitButton>
      </form>
      <p className="-mt-3 text-xs text-muted-foreground">
        Duration and schedule time are optional - leave the time blank and
        the scheduler places it automatically based on priority, deadline,
        and your working hours.
      </p>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex gap-1 overflow-x-auto pb-1 sm:pb-0">
          {STATUS_FILTERS.map((f) => (
            <Link
              key={f.value}
              href={f.value === "all" ? `/tasks?sort=${sort}` : `/tasks?status=${f.value}&sort=${sort}`}
            >
              <Button
                type="button"
                variant={status === f.value ? "secondary" : "ghost"}
                size="sm"
              >
                {f.label}
              </Button>
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          Sort by
          <div className="flex gap-1 overflow-x-auto">
            {SORTS.map((s) => (
              <Link
                key={s.value}
                href={status === "all" ? `/tasks?sort=${s.value}` : `/tasks?status=${status}&sort=${s.value}`}
              >
                <Button
                  type="button"
                  variant={sort === s.value ? "secondary" : "ghost"}
                  size="sm"
                >
                  {s.label}
                </Button>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {tasks?.length ? (
          tasks.map((task) => {
            const done = task.status === "done";
            const project = task.projects as unknown as {
              id: string;
              name: string;
            } | null;
            const overdue = isOverdue(task.deadline, task.status);
            return (
              <Card key={task.id}>
                <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <form action={toggleTaskDone}>
                      <input type="hidden" name="id" value={task.id} />
                      <input
                        type="hidden"
                        name="was_done"
                        value={String(done)}
                      />
                      <button
                        type="submit"
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={done ? "Mark open" : "Mark done"}
                      >
                        <Icon name={done ? "check_box" : "check_box_outline_blank"} size={16} />
                      </button>
                    </form>
                    <Link
                      href={`/tasks/${task.id}`}
                      className={`flex-1 truncate text-sm hover:underline ${done ? "text-muted-foreground line-through" : ""}`}
                    >
                      {task.title}
                    </Link>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-0 border-border/40 justify-between sm:justify-end">
                    {project && (
                      <Badge variant="muted">{project.name}</Badge>
                    )}
                    {task.deadline && (
                      <span
                        className={`text-xs ${overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}
                      >
                        {new Date(task.deadline).toLocaleDateString()}
                      </span>
                    )}
                    <PriorityBadge priority={task.priority} />
                    <Badge variant="muted">{task.status}</Badge>
                    <DeleteButton
                      action={deleteTask}
                      id={task.id}
                      confirmMessage={`Delete "${task.title}"?`}
                      label="Delete task"
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })
        ) : (
          <EmptyState
            icon="check_box"
            title="No tasks yet"
            description="Add one above, or create it from a capture in the Inbox once the pipeline is wired up."
          />
        )}
      </div>
    </div>
  );
}
