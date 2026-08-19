"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";

import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

export type GraphNode = { id: string; type: string; label: string };
export type GraphEdge = { source: string; target: string; kind: string; weight: number };

type SimNode = GraphNode & { x: number; y: number; degree: number };

const TYPE_META: Record<string, { label: string; icon: string; color: string; href?: string }> = {
  project: { label: "Projects", icon: "folder_special", color: "#6366f1", href: "/projects" },
  note: { label: "Notes", icon: "description", color: "#10b981", href: "/notes" },
  task: { label: "Tasks", icon: "check_box", color: "#f59e0b", href: "/tasks" },
  document: { label: "Documents", icon: "draft", color: "#a855f7" },
  entity: { label: "People & concepts", icon: "person", color: "#ec4899" },
  meeting: { label: "Meetings", icon: "groups", color: "#06b6d4" },
};

const WIDTH = 1000;
const HEIGHT = 640;

function layout(nodes: GraphNode[], edges: GraphEdge[]): { nodes: SimNode[]; edges: GraphEdge[] } {
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  const simNodes = nodes.map((n) => ({ ...n, degree: degree.get(n.id) ?? 0 })) as SimNode[];
  const simLinks = edges.map((e) => ({ ...e })) as unknown as {
    source: string | SimNode;
    target: string | SimNode;
  }[];

  const simulation = forceSimulation(simNodes as any)
    .force(
      "link",
      forceLink(simLinks as any)
        .id((d: any) => d.id)
        .distance(70)
        .strength(0.4),
    )
    .force("charge", forceManyBody().strength(-140))
    .force("center", forceCenter(WIDTH / 2, HEIGHT / 2))
    .force("collide", forceCollide((d: any) => 10 + Math.min(d.degree, 8) * 2))
    .stop();

  // Deterministic, synchronous layout: settle the simulation up front
  // rather than animating ticks in React state - a few hundred nodes
  // converges in well under a second and stays legible without a
  // continuous render loop fighting the user's pan/zoom.
  for (let i = 0; i < 300; i++) simulation.tick();

  return { nodes: simNodes, edges };
}

function bfsReachable(focusId: string, edges: GraphEdge[], maxDepth = 2): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    const s = typeof e.source === "string" ? e.source : (e.source as any).id;
    const t = typeof e.target === "string" ? e.target : (e.target as any).id;
    (adjacency.get(s) ?? adjacency.set(s, []).get(s)!).push(t);
    (adjacency.get(t) ?? adjacency.set(t, []).get(t)!).push(s);
  }

  const visited = new Set<string>([focusId]);
  let frontier = [focusId];
  for (let depth = 0; depth < maxDepth; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return visited;
}

export function GraphClient({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const { nodes: laidOut } = useMemo(() => layout(nodes, edges), [nodes, edges]);

  const presentTypes = useMemo(() => Array.from(new Set(nodes.map((n) => n.type))), [nodes]);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null,
  );
  const movedRef = useRef(false);

  const visibleNodeIds = useMemo(
    () => new Set(laidOut.filter((n) => !hiddenTypes.has(n.type)).map((n) => n.id)),
    [laidOut, hiddenTypes],
  );
  const visibleEdges = useMemo(
    () =>
      edges.filter(
        (e) =>
          visibleNodeIds.has(typeof e.source === "string" ? e.source : (e.source as any).id) &&
          visibleNodeIds.has(typeof e.target === "string" ? e.target : (e.target as any).id),
      ),
    [edges, visibleNodeIds],
  );

  const reachable = useMemo(
    () => (focusId ? bfsReachable(focusId, visibleEdges) : null),
    [focusId, visibleEdges],
  );

  const nodeById = useMemo(() => new Map(laidOut.map((n) => [n.id, n])), [laidOut]);

  function toggleType(type: string) {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function onWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault();
    const next = Math.min(3, Math.max(0.3, transform.k * (e.deltaY > 0 ? 0.92 : 1.08)));
    setTransform((t) => ({ ...t, k: next }));
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: transform.x,
      origY: transform.y,
    };
    movedRef.current = false;
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) movedRef.current = true;
    setTransform((t) => ({ ...t, x: dragRef.current!.origX + dx, y: dragRef.current!.origY + dy }));
  }
  function onPointerUp() {
    dragRef.current = null;
  }
  function onBackgroundClick() {
    // Node clicks call stopPropagation, so this only ever fires for a
    // genuine click on empty canvas - a pan gesture (tracked via
    // movedRef, not this handler alone) shouldn't also clear focus just
    // because the pointer happened to end over open space.
    if (!movedRef.current) setFocusId(null);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Node-type filters + legend */}
      <div className="flex flex-wrap items-center gap-2">
        {presentTypes.map((type) => {
          const meta = TYPE_META[type] ?? { label: type, icon: "circle", color: "#94a3b8" };
          const hidden = hiddenTypes.has(type);
          return (
            <button
              key={type}
              type="button"
              onClick={() => toggleType(type)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                hidden
                  ? "border-border/50 bg-transparent text-muted-foreground/50"
                  : "border-border bg-card text-foreground shadow-xs",
              )}
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: meta.color, opacity: hidden ? 0.35 : 1 }}
              />
              {meta.label}
            </button>
          );
        })}
        {focusId && (
          <button
            type="button"
            onClick={() => setFocusId(null)}
            className="ml-auto flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <Icon name="close" size={12} />
            Clear focus
          </button>
        )}
      </div>

      {/* Graph Canvas */}
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border/60 bg-card shadow-xs">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-full w-full cursor-grab active:cursor-grabbing"
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onClick={onBackgroundClick}
        >
          <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
            {visibleEdges.map((e, i) => {
              const s = nodeById.get(typeof e.source === "string" ? e.source : (e.source as any).id);
              const t = nodeById.get(typeof e.target === "string" ? e.target : (e.target as any).id);
              if (!s || !t) return null;
              const dimmed = reachable && (!reachable.has(s.id) || !reachable.has(t.id));
              return (
                <line
                  key={i}
                  x1={s.x}
                  y1={s.y}
                  x2={t.x}
                  y2={t.y}
                  stroke="currentColor"
                  className="text-border"
                  strokeWidth={e.kind === "relates_to" ? 1 : 1.5}
                  strokeDasharray={e.kind === "relates_to" ? "3 2" : undefined}
                  opacity={dimmed ? 0.06 : 0.5}
                />
              );
            })}
            {laidOut
              .filter((n) => visibleNodeIds.has(n.id))
              .map((n) => {
                const meta = TYPE_META[n.type] ?? { label: n.type, icon: "circle", color: "#94a3b8" };
                const dimmed = reachable && !reachable.has(n.id);
                const radius = 6 + Math.min(n.degree, 8) * 1.4;
                return (
                  <g
                    key={n.id}
                    transform={`translate(${n.x} ${n.y})`}
                    opacity={dimmed ? 0.15 : 1}
                    className="cursor-pointer"
                    onClick={(evt) => {
                      evt.stopPropagation();
                      setFocusId((prev) => (prev === n.id ? null : n.id));
                    }}
                  >
                    <circle r={radius} fill={meta.color} fillOpacity={0.85} />
                    <text
                      y={radius + 12}
                      textAnchor="middle"
                      fontSize={10}
                      className="fill-foreground/80 select-none"
                    >
                      {n.label.length > 22 ? `${n.label.slice(0, 20)}…` : n.label}
                    </text>
                  </g>
                );
              })}
          </g>
        </svg>
      </div>

      {focusId && nodeById.has(focusId) && (
        <FocusDetail node={nodeById.get(focusId)!} />
      )}
    </div>
  );
}

function FocusDetail({ node }: { node: SimNode }) {
  const meta = TYPE_META[node.type];
  const [, id] = node.id.split(":");
  // Projects have no detail route yet, only a list page - link there
  // without an id rather than to a 404.
  const href = node.type === "project" ? "/projects" : meta?.href ? `${meta.href}/${id}` : undefined;

  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm">
      <span
        className="flex size-6 shrink-0 items-center justify-center rounded-full text-white"
        style={{ backgroundColor: meta?.color ?? "#94a3b8" }}
      >
        <Icon name={meta?.icon ?? "circle"} size={14} />
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{node.label}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{meta?.label ?? node.type}</span>
      {href && (
        <Link href={href} className="shrink-0 text-xs font-medium text-primary hover:underline">
          Open
        </Link>
      )}
    </div>
  );
}
