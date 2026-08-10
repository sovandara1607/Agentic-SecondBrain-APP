import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function TaskDetailLoading() {
  return (
    <article className="max-w-xl space-y-4">
      {/* Back button */}
      <Skeleton className="h-4 w-24" />

      {/* Header title & status */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 flex-1">
          <Skeleton className="mt-1 size-5 shrink-0 rounded-sm" />
          <div className="space-y-1.5 flex-1">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-3 w-36" />
          </div>
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>

      {/* Form cards */}
      <div className="space-y-4">
        <Card>
          <CardContent className="space-y-3 p-6">
            <div className="space-y-1">
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
            <div className="space-y-1">
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-24 w-full rounded-md" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-16" />
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
            <div className="space-y-1">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
            <div className="space-y-1">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
            <div className="space-y-1">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
            <div className="col-span-2 space-y-1">
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-20" />
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-3 w-full" />
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>
      </div>

      <Skeleton className="h-9 w-24 rounded-md" />
    </article>
  );
}
