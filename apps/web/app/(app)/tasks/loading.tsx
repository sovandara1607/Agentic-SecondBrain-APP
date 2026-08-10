import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export default function TasksLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1.5">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-4 w-48" />
      </div>

      {/* Task Creation Form */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-9 min-w-48 flex-1 rounded-md" />
          <Skeleton className="h-9 w-36 rounded-md" />
          <Skeleton className="h-9 w-40 rounded-md" />
          <Skeleton className="h-9 w-40 rounded-md" />
          <Skeleton className="h-9 w-24 rounded-md" />
          <Skeleton className="h-9 w-52 rounded-md" />
          <Skeleton className="h-9 w-16 rounded-md" />
        </div>
        <Skeleton className="h-3.5 w-full max-w-lg" />
      </div>

      {/* Filters and Sort */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          <Skeleton className="h-8 w-12 rounded-md" />
          <Skeleton className="h-8 w-14 rounded-md" />
          <Skeleton className="h-8 w-14 rounded-md" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-12" />
          <div className="flex gap-1">
            <Skeleton className="h-8 w-16 rounded-md" />
            <Skeleton className="h-8 w-16 rounded-md" />
            <Skeleton className="h-8 w-16 rounded-md" />
          </div>
        </div>
      </div>

      {/* Tasks List */}
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex items-center gap-3">
              <Skeleton className="size-4 shrink-0 rounded-sm" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="size-7 rounded-md" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
