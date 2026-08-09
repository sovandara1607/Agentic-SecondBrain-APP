import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { DeleteButton } from "@/components/delete-button";
import { updateTask, deleteTask } from "../actions";

export default async function TaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: task }, { data: projects }] = await Promise.all([
    supabase
      .from("tasks")
      .select(
        "id, title, context, status, priority, energy_level, estimated_minutes, deadline, project_id, capture_id, created_at",
      )
      .eq("id", id)
      .single(),
    supabase.from("projects").select("id, name").order("name"),
  ]);

  if (!task) {
    notFound();
  }

  return (
    <article className="max-w-xl space-y-4">
      <p className="text-xs text-muted-foreground">
        {task.status}
        {task.capture_id && " · generated from a capture"}
      </p>

      <div className="space-y-3">
        <form action={updateTask} className="space-y-3">
          <input type="hidden" name="id" value={task.id} />
          <div className="space-y-1">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              name="title"
              defaultValue={task.title}
              className="font-heading text-xl font-semibold"
              required
            />
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

          <div className="grid grid-cols-2 gap-3">
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
              <Label htmlFor="estimated_minutes">Estimated minutes</Label>
              <Input
                id="estimated_minutes"
                name="estimated_minutes"
                type="number"
                min={5}
                step={5}
                defaultValue={task.estimated_minutes}
              />
            </div>
          </div>

          <div className="space-y-1">
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

          <Button type="submit">Save changes</Button>
        </form>

        <DeleteButton
          action={deleteTask}
          id={task.id}
          confirmMessage={`Delete "${task.title}"?`}
          label="Delete task"
          variant="button"
        />
      </div>
    </article>
  );
}
