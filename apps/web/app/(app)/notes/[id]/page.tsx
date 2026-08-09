import { notFound } from "next/navigation";
import { marked } from "marked";
import { Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DeleteButton } from "@/components/delete-button";
import { RichTextEditor } from "@/components/rich-text-editor";
import { updateNote, deleteNote } from "../actions";

export default async function NotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: note }, { data: taggings }] = await Promise.all([
    supabase
      .from("notes")
      .select(
        "id, title, content, note_type, ai_summary, capture_id, created_at, updated_at",
      )
      .eq("id", id)
      .single(),
    supabase
      .from("taggables")
      .select("tags(name)")
      .eq("taggable_type", "note")
      .eq("taggable_id", id),
  ]);

  if (!note) {
    notFound();
  }

  const html = await marked.parse(note.content);
  const tags = (taggings ?? [])
    .map((t) => (t.tags as unknown as { name: string } | null)?.name)
    .filter((name): name is string => Boolean(name));

  return (
    <article className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {note.note_type} &middot; updated{" "}
          {new Date(note.updated_at).toLocaleString()}
          {note.capture_id && " · generated from a capture"}
        </p>
        {tags.length > 0 && (
          <div className="flex gap-1">
            {tags.map((tag) => (
              <Badge key={tag} variant="muted">
                {tag}
              </Badge>
            ))}
          </div>
        )}
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
          <div className="space-y-1">
            <Label>Content</Label>
            <RichTextEditor name="content" initialValue={html} />
          </div>
          <Button type="submit">Save changes</Button>
        </form>

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
