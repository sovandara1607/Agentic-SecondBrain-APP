import Link from "next/link";
import { FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { RichTextEditor } from "@/components/rich-text-editor";
import { createNote } from "./actions";

export default async function NotesPage() {
  const supabase = await createClient();
  const { data: notes } = await supabase
    .from("notes")
    .select("id, title, note_type, updated_at")
    .order("updated_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Notes</h1>
        <p className="text-sm text-muted-foreground">
          Markdown notes, written directly or generated from captures.
        </p>
      </div>

      <form action={createNote} className="space-y-3">
        <Input name="title" placeholder="Title" required />
        <RichTextEditor name="content" />
        <Button type="submit">Save note</Button>
      </form>

      <div className="space-y-2">
        {notes?.length ? (
          notes.map((note) => (
            <Link key={note.id} href={`/notes/${note.id}`}>
              <Card className="transition-colors hover:bg-muted/50">
                <CardContent className="flex items-center justify-between gap-4">
                  <p className="truncate text-sm font-medium">{note.title}</p>
                  <p className="shrink-0 text-xs text-muted-foreground">
                    {new Date(note.updated_at).toLocaleDateString()}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))
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
