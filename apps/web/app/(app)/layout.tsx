import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-sidebar";
import { RealtimeRefresher } from "@/components/realtime-refresher";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [{ count: pendingCaptures }, { data: profile }] = await Promise.all([
    supabase
      .from("captures")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("profiles")
      .select("subscription_tier")
      .eq("id", user.id)
      .single(),
  ]);

  return (
    <AppShell
      email={user.email ?? ""}
      tier={profile?.subscription_tier ?? "free"}
      badges={{ inbox: pendingCaptures ?? 0 }}
    >
      {/* supabase/migrations/0011_realtime_publication.sql: re-renders
          whichever (app) page is mounted whenever captures/tasks/
          agent_actions change out from under it (pipeline progress,
          the Workflow agent's autonomous sweep, the missed-task pass)
          - also keeps this layout's own inbox badge count above
          current without a navigation. One instance here covers every
          page under (app) instead of duplicating it per-page. */}
      <RealtimeRefresher userId={user.id} tables={["captures", "tasks", "agent_actions"]} />
      {children}
    </AppShell>
  );
}
