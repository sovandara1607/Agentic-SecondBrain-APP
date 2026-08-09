import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createProject } from "./actions";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, overview, status, progress, created_at")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="text-sm text-muted-foreground">
          Group related notes and tasks toward a goal.
        </p>
      </div>

      <form action={createProject} className="flex gap-2">
        <Input name="name" placeholder="Project name" required />
        <Input name="overview" placeholder="Overview (optional)" />
        <Button type="submit">Create</Button>
      </form>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {projects?.length ? (
          projects.map((project) => (
            <Card key={project.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <span className="truncate">{project.name}</span>
                  <Badge variant="muted">{project.status}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {project.overview || "No overview yet."}
              </CardContent>
            </Card>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No projects yet.</p>
        )}
      </div>
    </div>
  );
}
