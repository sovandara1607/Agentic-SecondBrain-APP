import Link from "next/link";
import { FileText, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { RichTextEditor } from "@/components/rich-text-editor";
import { createNote } from "./actions";

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const supabase = await createClient();

  const [{ data: projects }, notesQuery] = await Promise.all([
    supabase.from("projects").select("id, name").order("name"),
    (() => {
      let query = supabase
        .from("notes")
        .select("id, title, note_type, updated_at, projects(id, name)")
        .order("updated_at", { ascending: false });
      if (q.trim()) {
        const escaped = q.trim().replace(/[%,]/g, "");
        query = query.or(`title.ilike.%${escaped}%,content.ilike.%${escaped}%`);
      }
      return query;
    })(),
  ]);
  const { data: notes } = notesQuery;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Notes</h1>
        <p className="text-sm text-muted-foreground">
          Markdown notes, written directly or generated from captures. Link
          to another note with [[Note Title]].
        </p>
      </div>

      <form action={createNote} className="space-y-3">
        <Input name="title" placeholder="Title" required />
        <div className="flex flex-wrap gap-2">
          <Select name="note_type" defaultValue="note" className="w-36">
            <option value="note">Note</option>
            <option value="meeting">Meeting</option>
            <option value="decision">Decision</option>
            <option value="summary">Summary</option>
          </Select>
          <Select name="project_id" defaultValue="" className="w-40">
            <option value="">No project</option>
            {projects?.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        </div>
        <RichTextEditor name="content" />
        <Button type="submit">Save note</Button>
      </form>

      <form method="GET" className="flex gap-2">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search notes..."
          className="max-w-xs"
        />
        <Button type="submit" variant="outline">
          <Search className="size-4" strokeWidth={1.75} />
          Search
        </Button>
      </form>

      <div className="space-y-2">
        {notes?.length ? (
          notes.map((note) => {
            const project = note.projects as unknown as {
              id: string;
              name: string;
            } | null;
            return (
              <Link key={note.id} href={`/notes/${note.id}`}>
                <Card className="transition-colors hover:bg-muted/50">
                  <CardContent className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-sm font-medium">
                        {note.title}
                      </p>
                      {note.note_type !== "note" && (
                        <Badge variant="muted">{note.note_type}</Badge>
                      )}
                      {project && <Badge variant="muted">{project.name}</Badge>}
                    </div>
                    <p className="shrink-0 text-xs text-muted-foreground">
                      {new Date(note.updated_at).toLocaleDateString()}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })
        ) : q.trim() ? (
          <EmptyState
            icon={Search}
            title="No matches"
            description={`Nothing found for "${q}".`}
          />
        ) : (
          <EmptyState
            icon={FileText}
            title="No notes yet"
            description="Write one above, or capture something in the Inbox first."
          />
        )}
      </div>
    </div>
  );
}
