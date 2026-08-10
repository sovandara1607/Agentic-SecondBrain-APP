import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1.5">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-64" />
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex items-center gap-3.5">
              <Skeleton className="size-10 shrink-0 rounded-lg" />
              <div className="flex flex-col gap-1.5 flex-1">
                <Skeleton className="h-6 w-10" />
                <Skeleton className="h-4 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent Notes */}
      <Card>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-28" />
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-2.5 rounded-md px-2 py-2"
              >
                <Skeleton className="size-4 shrink-0 rounded-sm" />
                <Skeleton className="h-4 flex-1 max-w-sm" />
                <Skeleton className="size-4 shrink-0 rounded-sm" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Features section */}
      <div>
        <Skeleton className="mb-3 h-4 w-24" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="flex items-start gap-3">
                <Skeleton className="size-8 shrink-0 rounded-md" />
                <div className="flex flex-col gap-1.5 flex-1">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
