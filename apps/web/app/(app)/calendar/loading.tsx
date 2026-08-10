import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export default function CalendarLoading() {
  return (
    <div className="space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-32 rounded-md" />
          <div className="flex items-center gap-1">
            <Skeleton className="size-9 rounded-md" />
            <Skeleton className="h-9 w-16 rounded-md" />
            <Skeleton className="size-9 rounded-md" />
          </div>
        </div>
      </div>

      {/* Main Grid & Side Panel Layout */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* Unscheduled Tasks Panel Skeleton */}
        <Card className="w-full lg:w-72 shrink-0 border-border/60">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-border/40 pb-2.5">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-5 w-8 rounded-full" />
            </div>
            <Skeleton className="h-3 w-full" />
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          </CardContent>
        </Card>

        {/* 7-Day Calendar Grid Skeleton */}
        <div className="flex-1 min-w-0 w-full overflow-x-auto rounded-xl border border-border/60 bg-card p-2 shadow-xs">
          <div className="grid min-w-[720px] grid-cols-[56px_repeat(7,1fr)] gap-2">
            <div />
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-1 py-2">
                <Skeleton className="h-3 w-8" />
                <Skeleton className="h-5 w-6" />
              </div>
            ))}

            <div className="space-y-8 py-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-3 w-10" />
              ))}
            </div>
            {Array.from({ length: 7 }).map((_, dayIdx) => (
              <div key={dayIdx} className="relative h-96 border-l border-border/40 pl-1.5 pt-2">
                <Skeleton
                  className="w-full rounded-md"
                  style={{
                    height: `${35 + (dayIdx % 3) * 20}px`,
                    marginTop: `${(dayIdx * 35) % 150}px`,
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
