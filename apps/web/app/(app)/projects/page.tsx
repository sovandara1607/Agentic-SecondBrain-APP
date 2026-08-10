import { FolderKanban } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { DeleteButton } from "@/components/delete-button";
import { PlannerButton } from "@/components/planner-button";
import { createProject, deleteProject } from "./actions";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, overview, status, progress, created_at")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Projects</h1>
        <p className="text-sm text-muted-foreground">
          Group related notes and tasks toward a goal.
        </p>
      </div>

      <form action={createProject} className="flex flex-col sm:flex-row gap-2">
        <Input name="name" placeholder="Project name" required className="w-full" />
        <Input name="overview" placeholder="Overview (optional)" className="w-full" />
        <Button type="submit" className="w-full sm:w-auto">Create</Button>
      </form>

      {projects?.length ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {projects.map((project) => (
            <Card key={project.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <span className="truncate">{project.name}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge variant="muted">{project.status}</Badge>
                    <DeleteButton
                      action={deleteProject}
                      id={project.id}
                      confirmMessage={`Delete "${project.name}"? This can't be undone.`}
                      label="Delete project"
                    />
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                {project.overview || "No overview yet."}
                <PlannerButton
                  apiUrl={process.env.NEXT_PUBLIC_API_URL!}
                  projectId={project.id}
                  projectName={project.name}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="Create one above to start grouping tasks and notes toward a goal."
        />
      )}
    </div>
  );
}
