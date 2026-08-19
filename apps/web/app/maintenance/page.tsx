import { Icon } from "@/components/ui/icon";

// Deliberately outside the (app) route group: that layout calls
// supabase.auth.getUser() before rendering anything, which is exactly
// the kind of backend round-trip maintenance mode needs to survive
// without depending on (proxy.ts redirects here - see MAINTENANCE_MODE
// there - specifically so this page renders even when Supabase itself
// is the thing down for maintenance). No data fetching, no client
// interactivity - a static page can't itself go down.
export default function MaintenancePage() {
  const message = process.env.MAINTENANCE_MESSAGE;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon name="construction" size={28} />
      </span>
      <h1 className="font-heading text-2xl font-semibold">Down for maintenance</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        {message || "We're making some updates behind the scenes. This won't take long - try again shortly."}
      </p>
    </main>
  );
}
