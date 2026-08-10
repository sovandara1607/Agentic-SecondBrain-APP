import { Skeleton } from "@/components/ui/skeleton";

export default function WorkspaceLoading() {
  return (
    <div className="flex h-full min-h-[calc(100vh-8rem)] flex-col">
      {/* Header */}
      <div className="mb-4 space-y-1.5">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      {/* Chat workspace skeleton */}
      <div className="flex flex-1 gap-4 overflow-hidden rounded-xl border border-border/60 bg-card p-4">
        {/* Conversations sidebar skeleton */}
        <div className="hidden w-64 space-y-3 sm:block">
          <Skeleton className="h-9 w-full rounded-md" />
          <div className="space-y-2 pt-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded-md" />
            ))}
          </div>
        </div>

        {/* Message area skeleton */}
        <div className="flex flex-1 flex-col justify-between space-y-4">
          <div className="space-y-4 pt-4">
            <div className="flex gap-3">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </div>
            <div className="flex gap-3 flex-row-reverse">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <Skeleton className="h-10 w-2/3 rounded-xl" />
            </div>
          </div>

          <Skeleton className="h-12 w-full rounded-md" />
        </div>
      </div>
    </div>
  );
}
