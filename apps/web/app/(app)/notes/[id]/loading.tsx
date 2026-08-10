import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export default function NoteDetailLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Top Header & Actions Bar */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-28" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-28 rounded-md" />
          <Skeleton className="h-9 w-16 rounded-md" />
        </div>
      </div>

      {/* Header Info Banner */}
      <div className="space-y-3 rounded-xl border border-border/60 bg-card p-5">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-4 w-32 ml-auto" />
        </div>
        <Skeleton className="h-8 w-3/4" />
        <div className="flex items-center gap-1.5 pt-1 border-t border-border/40">
          <Skeleton className="h-5 w-14 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-6 w-20 rounded-md" />
        </div>
      </div>

      {/* Reading Canvas */}
      <Card>
        <CardContent className="space-y-4 p-6">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-5/6" />
          <Skeleton className="h-5 w-4/6" />
          <Skeleton className="h-24 w-full rounded-md" />
        </CardContent>
      </Card>
    </div>
  );
}
