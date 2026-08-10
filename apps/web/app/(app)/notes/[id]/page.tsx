import { notFound } from "next/navigation";
import { marked } from "marked";
import { createClient } from "@/lib/supabase/server";
import { NoteDetailView } from "./note-detail-view";

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
    <NoteDetailView
      note={note}
      html={html}
      tags={tags}
      projects={projects ?? []}
      linkedNotes={(linkedNotes ?? []) as unknown as { id: string; title: string }[]}
      backlinkNotes={(backlinkNotes ?? []) as unknown as { id: string; title: string }[]}
    />
  );
}
