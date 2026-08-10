import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-sidebar";

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
      {children}
    </AppShell>
  );
}
