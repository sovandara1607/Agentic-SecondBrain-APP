import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppSidebar } from "@/components/app-sidebar";
import { PageBreadcrumb } from "@/components/page-breadcrumb";

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
    <div className="flex min-h-screen bg-background">
      <AppSidebar
        email={user.email ?? ""}
        tier={profile?.subscription_tier ?? "free"}
        badges={{ inbox: pendingCaptures ?? 0 }}
      />
      <div className="flex flex-1 flex-col">
        <header className="flex items-center border-b px-6 py-3">
          <PageBreadcrumb />
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
