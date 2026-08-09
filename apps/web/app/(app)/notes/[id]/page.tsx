import Link from "next/link";
import { notFound } from "next/navigation";
import { marked } from "marked";
import { Sparkles, Link2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DeleteButton } from "@/components/delete-button";
import { RichTextEditor } from "@/components/rich-text-editor";
import {
  updateNote,
  deleteNote,
  addNoteTag,
  removeNoteTag,
} from "../actions";

export default async function NotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: note }, { data: taggings }, { data: projects }] =
    await Promise.all([
      supabase
        .from("notes")
        .select(
          "id, title, content, note_type, project_id, ai_summary, capture_id, created_at, updated_at",
        )
        .eq("id", id)
        .single(),
      supabase
        .from("taggables")
        .select("tag_id, tags(id, name)")
        .eq("taggable_type", "note")
        .eq("taggable_id", id),
      supabase.from("projects").select("id, name").order("name"),
    ]);

  if (!note) {
    notFound();
  }

  const [{ data: outgoing }, { data: incoming }] = await Promise.all([
    supabase
      .from("relationships")
      .select("target_id")
      .eq("source_type", "note")
      .eq("source_id", id)
      .eq("relation_kind", "mentions"),
    supabase
      .from("relationships")
      .select("source_id")
      .eq("target_type", "note")
      .eq("target_id", id)
      .eq("relation_kind", "mentions"),
  ]);

  const linkedIds = [...new Set((outgoing ?? []).map((r) => r.target_id))];
  const backlinkIds = [...new Set((incoming ?? []).map((r) => r.source_id))];
  const [{ data: linkedNotes }, { data: backlinkNotes }] = await Promise.all([
    linkedIds.length
      ? supabase.from("notes").select("id, title").in("id", linkedIds)
      : Promise.resolve({ data: [] }),
    backlinkIds.length
      ? supabase.from("notes").select("id, title").in("id", backlinkIds)
      : Promise.resolve({ data: [] }),
  ]);

  const html = await marked.parse(note.content);
  const tags = (taggings ?? [])
    .map((t) => t.tags as unknown as { id: string; name: string } | null)
    .filter((t): t is { id: string; name: string } => Boolean(t));

  return (
    <article className="max-w-2xl space-y-4">
      <p className="text-xs text-muted-foreground">
        {note.note_type} &middot; updated{" "}
        {new Date(note.updated_at).toLocaleString()}
        {note.capture_id && " · generated from a capture"}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <form key={tag.id} action={removeNoteTag} className="inline-flex">
            <input type="hidden" name="note_id" value={note.id} />
            <input type="hidden" name="tag_id" value={tag.id} />
            <Badge variant="muted" className="gap-1 pr-1">
              {tag.name}
              <button
                type="submit"
                aria-label={`Remove tag ${tag.name}`}
                className="rounded-full hover:text-destructive"
              >
                <X className="size-3" strokeWidth={2} />
              </button>
            </Badge>
          </form>
        ))}
        <form action={addNoteTag} className="inline-flex items-center gap-1">
          <input type="hidden" name="note_id" value={note.id} />
          <Input
            name="tag_name"
            placeholder="Add tag..."
            className="h-6 w-24 px-2 text-xs"
          />
          <Button type="submit" size="xs" variant="ghost">
            Add
          </Button>
        </form>
      </div>

      {note.ai_summary && (
        <Card>
          <CardContent className="flex items-start gap-2.5">
            <Sparkles
              className="mt-0.5 size-4 shrink-0 text-primary"
              strokeWidth={1.75}
            />
            <p className="text-sm text-muted-foreground">{note.ai_summary}</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        <form action={updateNote} className="space-y-3">
          <input type="hidden" name="id" value={note.id} />
          <div className="space-y-1">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              name="title"
              defaultValue={note.title}
              className="font-heading text-xl font-semibold"
              required
            />
          </div>

          <div className="flex gap-2">
            <div className="space-y-1">
              <Label htmlFor="note_type">Type</Label>
              <Select
                id="note_type"
                name="note_type"
                defaultValue={note.note_type}
                className="w-36"
              >
                <option value="note">Note</option>
                <option value="meeting">Meeting</option>
                <option value="decision">Decision</option>
                <option value="summary">Summary</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="project_id">Project</Label>
              <Select
                id="project_id"
                name="project_id"
                defaultValue={note.project_id ?? ""}
                className="w-40"
              >
                <option value="">No project</option>
                {projects?.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Content</Label>
            <RichTextEditor name="content" initialValue={html} />
          </div>
          <Button type="submit">Save changes</Button>
        </form>

        {(linkedNotes?.length ?? 0) > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              Linked notes
            </p>
            <div className="flex flex-wrap gap-1.5">
              {linkedNotes!.map((n) => (
                <Link key={n.id} href={`/notes/${n.id}`}>
                  <Badge variant="muted" className="gap-1">
                    <Link2 className="size-3" strokeWidth={1.75} />
                    {n.title}
                  </Badge>
                </Link>
              ))}
            </div>
          </div>
        )}

        {(backlinkNotes?.length ?? 0) > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              Linked from
            </p>
            <div className="flex flex-wrap gap-1.5">
              {backlinkNotes!.map((n) => (
                <Link key={n.id} href={`/notes/${n.id}`}>
                  <Badge variant="muted" className="gap-1">
                    <Link2 className="size-3" strokeWidth={1.75} />
                    {n.title}
                  </Badge>
                </Link>
              ))}
            </div>
          </div>
        )}

        <DeleteButton
          action={deleteNote}
          id={note.id}
          confirmMessage={`Delete "${note.title}"? This can't be undone.`}
          label="Delete note"
          variant="button"
        />
      </div>
    </article>
  );
}
