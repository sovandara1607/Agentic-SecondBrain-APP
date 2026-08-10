import { Skeleton } from "@/components/ui/skeleton";

export default function ReviewsLoading() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-7 w-28" />
      <Skeleton className="h-4 w-80 max-w-full" />
    </div>
  );
}
