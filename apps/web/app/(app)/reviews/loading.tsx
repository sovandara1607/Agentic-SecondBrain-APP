import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

function ReviewCardSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-16 w-full rounded-lg" />
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-2 w-full rounded-full" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-3/4" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SectionSkeleton({ rows }: { rows?: number }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>
      <ReviewCardSkeleton rows={rows} />
    </div>
  );
}

export default function ReviewsLoading() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="space-y-1.5">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      {/* Monthly Reviews */}
      <SectionSkeleton rows={2} />

      {/* Weekly Reviews */}
      <SectionSkeleton rows={2} />

      {/* Daily Reviews */}
      <SectionSkeleton rows={4} />
    </div>
  );
}
