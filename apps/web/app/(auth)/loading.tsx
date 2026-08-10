import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export default function AuthLoading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-4 p-6">
          <div className="space-y-1.5 text-center">
            <Skeleton className="mx-auto h-7 w-32" />
            <Skeleton className="mx-auto h-4 w-48" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
