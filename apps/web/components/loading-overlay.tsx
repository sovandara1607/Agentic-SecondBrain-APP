import { Icon } from "@/components/ui/icon";

/**
 * A dedicated loading state for a whole feature panel (Planner/Research/
 * Writer's expanded forms, Workflow Check's results area), not just a
 * button's own busy text - covers the form so its (now-disabled)
 * inputs don't look like they're just sitting there doing nothing
 * during a multi-second agent call. Render inside a `relative`
 * container so this `absolute inset-0` actually covers it.
 */
export function LoadingOverlay({ message }: { message: string }) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg bg-card/80 backdrop-blur-[1px] animate-in fade-in duration-150">
      <Icon name="progress_activity" size={22} className="animate-spin text-primary" />
      <p className="text-xs font-medium text-muted-foreground">{message}</p>
    </div>
  );
}
