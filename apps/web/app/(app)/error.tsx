"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-6">
      <p className="text-sm font-medium text-destructive">
        This page hit an error and couldn&apos;t finish rendering.
      </p>
      <p className="text-sm text-muted-foreground">
        Reloading usually clears this - it can happen when the app updates
        while a tab was already open. If retrying and reloading both fail,
        sign out and back in in case your session expired.
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => reset()}>
          Try again
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.location.reload()}
        >
          Reload page
        </Button>
      </div>
    </div>
  );
}
