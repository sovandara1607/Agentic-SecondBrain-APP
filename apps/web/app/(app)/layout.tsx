import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NavSidebar } from "@/components/nav-sidebar";
import { SignOutButton } from "@/components/sign-out-button";

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

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="flex w-56 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="p-4">
          <p className="text-sm font-semibold text-sidebar-foreground">
            Second Brain
          </p>
        </div>
        <NavSidebar />
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b px-6 py-3">
          <span className="text-sm text-muted-foreground">{user.email}</span>
          <SignOutButton />
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
