import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export default function NotesLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 border-b border-border/60 pb-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-20 rounded-lg" />
        ))}
      </div>

      {/* Search & Project Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <Skeleton className="h-9 w-full flex-1 rounded-md" />
        <Skeleton className="h-9 w-full sm:w-48 rounded-md" />
        <Skeleton className="h-9 w-full sm:w-20 rounded-md" />
      </div>

      {/* Notes Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex h-36 flex-col justify-between p-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-full" />
              </div>
              <div className="flex items-center justify-between border-t border-border/40 pt-2.5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="size-4 rounded-sm" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
