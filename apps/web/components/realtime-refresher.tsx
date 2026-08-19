"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const DEBOUNCE_MS = 400;

/**
 * Subscribes to Postgres change events (supabase/migrations/0011_
 * realtime_publication.sql) for the given tables, scoped to the current
 * user's own rows, and re-runs the page's server component on any
 * change - the simplest correct way to keep a Server Component's data
 * fresh against writes that don't originate from this tab (the capture
 * pipeline advancing a status, the Workflow agent's autonomous sweep,
 * the missed-task pass). Renders nothing; mount it once per page.
 *
 * Realtime authorizes each subscription against the same RLS policies
 * already on these tables (see the migration's comment) - the
 * `filter: user_id=eq.<userId>` below is defense-in-depth matching this
 * codebase's existing convention, not the only thing stopping a cross-
 * user subscription.
 *
 * Debounced: the pipeline alone writes to `captures` and touches
 * `tasks` several times in quick succession for one capture, and
 * router.refresh() is a real request each time - collapsing a burst
 * into a single refresh avoids hammering the server component for one
 * logical event.
 */
export function RealtimeRefresher({
  userId,
  tables,
}: {
  userId: string;
  tables: string[];
}) {
  const router = useRouter();
  const tableKey = tables.join(",");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`live:${tableKey}:${userId}`);

    for (const table of tableKey.split(",")) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `user_id=eq.${userId}` },
        () => {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          timeoutRef.current = setTimeout(() => router.refresh(), DEBOUNCE_MS);
        },
      );
    }

    channel.subscribe();

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, tableKey]);

  return null;
}
