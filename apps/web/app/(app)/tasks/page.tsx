import { CheckSquare, Square } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { DeleteButton } from "@/components/delete-button";
import { createTask, toggleTaskDone, deleteTask } from "./actions";

export default async function TasksPage() {
  const supabase = await createClient();
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, status, priority, deadline, created_at")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Tasks</h1>
        <p className="text-sm text-muted-foreground">
          What needs to get done.
        </p>
      </div>

      <form action={createTask} className="flex gap-2">
        <Input name="title" placeholder="Add a task..." required />
        <Button type="submit">Add</Button>
      </form>

      <div className="space-y-2">
        {tasks?.length ? (
          tasks.map((task) => {
            const done = task.status === "done";
            return (
              <Card key={task.id}>
                <CardContent className="flex items-center gap-3">
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
                      {done ? (
                        <CheckSquare className="size-4" />
                      ) : (
                        <Square className="size-4" />
                      )}
                    </button>
                  </form>
                  <p
                    className={`flex-1 truncate text-sm ${done ? "text-muted-foreground line-through" : ""}`}
                  >
                    {task.title}
                  </p>
                  <Badge variant="muted">{task.status}</Badge>
                  <DeleteButton
                    action={deleteTask}
                    id={task.id}
                    confirmMessage={`Delete "${task.title}"?`}
                    label="Delete task"
                  />
                </CardContent>
              </Card>
            );
          })
        ) : (
          <EmptyState
            icon={CheckSquare}
            title="No tasks yet"
            description="Add one above, or create it from a capture in the Inbox once the pipeline is wired up."
          />
        )}
      </div>
    </div>
  );
}
