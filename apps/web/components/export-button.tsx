"use client";

import { useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { friendlyError } from "@/lib/friendly-error";

export function ExportButton({ apiUrl }: { apiUrl: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  async function exportData() {
    setBusy(true);
    setError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setError("Your session expired. Refresh the page and sign in again.");
        return;
      }

      const response = await fetch(`${apiUrl}/export`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!response.ok) {
        throw new Error(`Export failed (${response.status})`);
      }

      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="(.+)"/);
      const filename = match?.[1] ?? "second-brain-export.zip";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("export failed:", err);
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <Button variant="outline" size="sm" onClick={exportData} disabled={busy} className="gap-1.5">
        <Icon name={busy ? "progress_activity" : "download"} size={16} className={busy ? "animate-spin" : undefined} />
        {busy ? "Preparing export..." : "Export data"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Downloads every note, task, and project as markdown files with frontmatter - open the
        folder directly as an Obsidian vault.
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
