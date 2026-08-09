import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
    { label: "Open tasks", value: openTasks.count ?? 0, href: "/tasks" },
    {
      label: "Pending captures",
      value: pendingCaptures.count ?? 0,
      href: "/inbox",
    },
    {
      label: "Active projects",
      value: activeProjects.count ?? 0,
      href: "/projects",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Welcome back{user?.email ? `, ${user.email}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">
          Here&apos;s what&apos;s going on in your second brain.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <Card className="transition-colors hover:bg-muted/50">
              <CardHeader>
                <CardTitle className="text-3xl font-semibold">
                  {stat.value}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {stat.label}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent notes</CardTitle>
        </CardHeader>
        <CardContent>
          {recentNotes.data?.length ? (
            <ul className="divide-y">
              {recentNotes.data.map((note) => (
                <li key={note.id} className="py-2">
                  <Link
                    href={`/notes/${note.id}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {note.title}
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
    </div>
  );
}
