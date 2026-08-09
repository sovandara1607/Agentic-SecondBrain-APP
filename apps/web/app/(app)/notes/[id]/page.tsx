import { notFound } from "next/navigation";
import { marked } from "marked";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const { data: note } = await supabase
    .from("notes")
    .select("id, title, content, note_type, created_at, updated_at")
    .eq("id", id)
    .single();

  if (!note) {
    notFound();
  }

  const html = await marked.parse(note.content);

  return (
    <article className="max-w-2xl space-y-4">
      <p className="text-xs text-muted-foreground">
        {note.note_type} &middot; updated{" "}
        {new Date(note.updated_at).toLocaleString()}
      </p>

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
