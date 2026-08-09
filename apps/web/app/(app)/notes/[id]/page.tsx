import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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

  return (
    <article className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{note.title}</h1>
        <p className="text-xs text-muted-foreground">
          {note.note_type} &middot; updated{" "}
          {new Date(note.updated_at).toLocaleString()}
        </p>
      </div>
      <div className="whitespace-pre-wrap text-sm leading-relaxed">
        {note.content}
      </div>
    </article>
  );
}
