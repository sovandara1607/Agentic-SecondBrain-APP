import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/empty-state";
import { GraphClient, type GraphEdge, type GraphNode } from "./graph-client";
import { Trans } from "@/components/trans";

export default async function GraphPage() {
  const supabase = await createClient();

  const [relationshipsRes, projectsRes, notesRes, tasksRes, documentsRes, entitiesRes, meetingsRes] =
    await Promise.all([
      supabase
        .from("relationships")
        .select("id, source_type, source_id, target_type, target_id, relation_kind, weight"),
      supabase.from("projects").select("id, name"),
      supabase.from("notes").select("id, title, note_type"),
      supabase.from("tasks").select("id, title"),
      supabase.from("documents").select("id, title"),
      supabase.from("entities").select("id, name, kind"),
      supabase.from("meetings").select("id, occurred_at, notes(title)"),
    ]);

  const relationships = relationshipsRes.data ?? [];

  // Node type -> id -> label, so every relationship endpoint (whatever
  // its source_type/target_type) can be resolved to something a human
  // reads, not a bare uuid (Section 14's node types map 1:1 onto these
  // object tables).
  const labelsByType: Record<string, Map<string, string>> = {
    project: new Map((projectsRes.data ?? []).map((p) => [p.id, p.name])),
    note: new Map((notesRes.data ?? []).map((n) => [n.id, n.title])),
    task: new Map((tasksRes.data ?? []).map((t) => [t.id, t.title])),
    document: new Map((documentsRes.data ?? []).map((d) => [d.id, d.title])),
    entity: new Map((entitiesRes.data ?? []).map((e) => [e.id, e.name])),
    meeting: new Map(
      (meetingsRes.data ?? []).map((m) => [
        m.id,
        // @ts-expect-error - Supabase's generated type for this embedded
        // relation doesn't narrow to a single object, but the FK is 1:1
        (m.notes?.title as string | undefined) ??
          `Meeting, ${new Date(m.occurred_at).toLocaleDateString()}`,
      ]),
    ),
  };

  const nodeMap = new Map<string, GraphNode>();
  function addNode(type: string, id: string) {
    const key = `${type}:${id}`;
    if (!nodeMap.has(key)) {
      nodeMap.set(key, {
        id: key,
        type,
        label: labelsByType[type]?.get(id) ?? "(untitled)",
      });
    }
    return key;
  }

  const edges: GraphEdge[] = [];
  for (const r of relationships) {
    const source = addNode(r.source_type, r.source_id);
    const target = addNode(r.target_type, r.target_id);
    edges.push({ source, target, kind: r.relation_kind, weight: r.weight });
  }

  const nodes = Array.from(nodeMap.values());

  return (
    <div className="flex h-[calc(100dvh-8rem)] flex-col space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold"><Trans id="knowledgeGraph" /></h1>
        <p className="text-sm text-muted-foreground">
          Everything the pipeline and agents have connected - projects, notes, tasks, documents,
          and people, linked by mention, similarity, and structure.
        </p>
      </div>

      {nodes.length ? (
        <GraphClient nodes={nodes} edges={edges} />
      ) : (
        <EmptyState
          icon="hub"
          title="Nothing to graph yet"
          description="The graph fills in as captures get processed and notes, tasks, and projects get linked."
        />
      )}
    </div>
  );
}
