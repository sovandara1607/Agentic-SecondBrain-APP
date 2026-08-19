import { Icon } from "@/components/ui/icon";

export function EmptyState({
  icon,
  title,
  description,
}: {
  /** Material Symbols ligature name, e.g. "inbox". */
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-14 text-center">
      <span className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon name={icon} size={20} />
      </span>
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-xs text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
