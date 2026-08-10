import Link from "next/link";
import {
  CheckSquare,
  Inbox,
  FolderKanban,
  ChevronRight,
  FileText,
  Calendar,
  Sparkles,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";

const FEATURES = [
  {
    label: "Inbox",
    href: "/inbox",
    icon: Inbox,
    description: "Drop in a thought or a link. Nothing gets organized here yet - that's the AI pipeline, still to come.",
  },
  {
    label: "Notes",
    href: "/notes",
    icon: FileText,
    description: "Write markdown notes directly, or they'll show up here once captures get processed.",
  },
  {
    label: "Tasks",
    href: "/tasks",
    icon: CheckSquare,
    description: "Plain to-dos: add one, check it off when it's done.",
  },
  {
    label: "Projects",
    href: "/projects",
    icon: FolderKanban,
    description: "Group related notes and tasks under a shared goal.",
  },
  {
    label: "Calendar",
    href: "/calendar",
    icon: Calendar,
    description: "Automatically scheduled from your open tasks, priority, and working hours.",
  },
  {
    label: "Reviews",
    href: "/reviews",
    icon: Sparkles,
    description: "Not built yet - AI-generated daily/weekly reviews land in Phase 4.",
  },
];

export default async function DashboardPage() {
  const supabase = await createClient();

  const [openTasks, pendingCaptures, activeProjects, recentNotes] =
    await Promise.all([
      supabase
        .from("tasks")
        .select("*", { count: "exact", head: true })
        .eq("status", "open"),
      supabase
        .from("captures")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase
        .from("projects")
        .select("*", { count: "exact", head: true })
        .eq("status", "active"),
      supabase
        .from("notes")
        .select("id, title, created_at")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  const stats = [
    {
      label: "Open tasks",
      value: openTasks.count ?? 0,
      href: "/tasks",
      icon: CheckSquare,
    },
    {
      label: "Pending captures",
      value: pendingCaptures.count ?? 0,
      href: "/inbox",
      icon: Inbox,
    },
    {
      label: "Active projects",
      value: activeProjects.count ?? 0,
      href: "/projects",
      icon: FolderKanban,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Welcome back</h1>
        <p className="text-sm text-muted-foreground">
          Here&apos;s what&apos;s going on in your second brain.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <Card className="transition-colors hover:bg-muted/50">
              <CardContent className="flex items-center gap-3.5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <stat.icon className="size-5" strokeWidth={1.75} />
                </span>
                <span className="flex flex-col">
                  <span className="font-heading text-2xl leading-none font-semibold text-primary">
                    {stat.value}
                  </span>
                  <span className="mt-1 text-sm text-muted-foreground">
                    {stat.label}
                  </span>
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardContent>
          <h2 className="font-heading mb-1 text-sm font-semibold">
            Recent notes
          </h2>
          {recentNotes.data?.length ? (
            <ul className="-mx-2 divide-y divide-border">
              {recentNotes.data.map((note) => (
                <li key={note.id}>
                  <Link
                    href={`/notes/${note.id}`}
                    className="flex items-center gap-2.5 rounded-md px-2 py-2.5 text-sm transition-colors hover:bg-muted/50"
                  >
                    <FileText
                      className="size-4 shrink-0 text-muted-foreground"
                      strokeWidth={1.75}
                    />
                    <span className="flex-1 truncate font-medium">
                      {note.title}
                    </span>
                    <ChevronRight
                      className="size-4 shrink-0 text-muted-foreground/50"
                      strokeWidth={1.75}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No notes yet. Capture something in the Inbox to get started.
            </p>
          )}
        </CardContent>
      </Card>

      <div>
        <h2 className="font-heading mb-3 text-sm font-semibold">
          What&apos;s here
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <Link key={feature.label} href={feature.href}>
              <Card className="h-full transition-colors hover:bg-muted/50">
                <CardContent className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <feature.icon className="size-4" strokeWidth={1.75} />
                  </span>
                  <span className="flex flex-col">
                    <span className="text-sm font-medium">
                      {feature.label}
                    </span>
                    <span className="mt-0.5 text-xs text-muted-foreground">
                      {feature.description}
                    </span>
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
