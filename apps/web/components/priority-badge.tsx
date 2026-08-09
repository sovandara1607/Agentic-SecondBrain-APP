import { Badge } from "@/components/ui/badge";

const PRIORITY_LABEL: Record<number, string> = {
  1: "P1 · Highest",
  2: "P2 · High",
  3: "P3 · Medium",
  4: "P4 · Low",
  5: "P5 · Lowest",
};

const PRIORITY_VARIANT: Record<
  number,
  "destructive" | "warning" | "muted" | "success"
> = {
  1: "destructive",
  2: "warning",
  3: "muted",
  4: "muted",
  5: "success",
};

export function PriorityBadge({ priority }: { priority: number }) {
  return (
    <Badge variant={PRIORITY_VARIANT[priority] ?? "muted"}>
      {`P${priority}`}
    </Badge>
  );
}

export { PRIORITY_LABEL };
