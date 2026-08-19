import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function SettingsLoading() {
  return (
    <div className="mx-auto max-w-lg space-y-6">
      {/* Header */}
      <div className="space-y-1.5">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-4 w-52" />
      </div>

      {/* Profile Form Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-12 rounded-full" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Skeleton className="h-4 w-10" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
          <div className="space-y-1">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
          <Skeleton className="h-9 w-16 rounded-md" />
        </CardContent>
      </Card>

      {/* Scheduling Preferences Card */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-44" />
        </CardHeader>
        <CardContent className="space-y-5">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />

          {/* Working hours */}
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-28 rounded-md" />
              <Skeleton className="h-4 w-6" />
              <Skeleton className="h-9 w-28 rounded-md" />
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-11 rounded-full" />
              ))}
            </div>
          </div>

          {/* Energy profile */}
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-full" />
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-1">
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-9 w-full rounded-md" />
                </div>
              ))}
            </div>
          </div>

          {/* Scheduler weights */}
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-full" />
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-1">
                  <Skeleton className="h-3 w-14" />
                  <Skeleton className="h-9 w-full rounded-md" />
                </div>
              ))}
            </div>
          </div>

          <Skeleton className="h-9 w-32 rounded-md" />
        </CardContent>
      </Card>

      {/* Data Export Card */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Skeleton className="h-8 w-36 rounded-md" />
          <Skeleton className="h-3 w-full" />
        </CardContent>
      </Card>

      {/* API Tokens Card */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-3 w-full" />
          <div className="flex gap-2">
            <Skeleton className="h-9 flex-1 rounded-md" />
            <Skeleton className="h-9 w-24 shrink-0 rounded-md" />
          </div>
          <div className="space-y-1.5">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
