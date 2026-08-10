import { createClient } from "@/lib/supabase/server";
import { NotesClient } from "./notes-client";

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; project?: string }>;
}) {
  const { q = "", type = "all", project = "" } = await searchParams;
  const supabase = await createClient();

  const [{ data: projects }, notesQuery] = await Promise.all([
    supabase.from("projects").select("id, name").order("name"),
    (() => {
      let query = supabase
        .from("notes")
        .select("id, title, content, note_type, updated_at, projects(id, name)")
        .order("updated_at", { ascending: false });

      if (type && type !== "all") {
        query = query.eq("note_type", type);
      }

      if (project) {
        query = query.eq("project_id", project);
      }

      const escaped = q.trim().replace(/[^\p{L}\p{N} ]+/gu, "").trim();
      if (escaped) {
        query = query.or(`title.ilike.%${escaped}%,content.ilike.%${escaped}%`);
      }

      return query;
    })(),
  ]);

  const { data: notes } = notesQuery;

  return (
    <NotesClient
      notes={(notes ?? []) as unknown as Parameters<typeof NotesClient>[0]["notes"]}
      projects={projects ?? []}
      initialQuery={q}
      initialType={type}
      initialProject={project}
    />
  );
}
