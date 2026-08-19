"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { friendlyError } from "@/lib/friendly-error";
import { useLocale } from "@/lib/i18n/locale-provider";

export function WeeklyReviewButton({
  apiUrl,
  hasThisWeek,
}: {
  apiUrl: string;
  hasThisWeek: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const { locale } = useLocale();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  async function generate() {
    setBusy(true);
    setError(null);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setError("Your session expired. Refresh the page and sign in again.");
      setBusy(false);
      return;
    }

    try {
      const response = await fetch(`${apiUrl}/agents/review/weekly`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ language: locale }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.detail || `Request failed (${response.status})`);
      }
      router.refresh();
    } catch (err) {
      console.error("weekly review generation failed:", err);
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button size="sm" variant="outline" onClick={generate} disabled={busy} className="gap-1.5">
        <Icon name={busy ? "progress_activity" : "insights"} size={16} className={busy ? "animate-spin" : undefined} />
        {busy ? "Generating..." : hasThisWeek ? "Regenerate this week" : "Generate this week"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
