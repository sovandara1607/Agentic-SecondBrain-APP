"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { LoadingOverlay } from "@/components/loading-overlay";
import { friendlyError } from "@/lib/friendly-error";
import { useLocale } from "@/lib/i18n/locale-provider";

export function PlannerButton({
  apiUrl,
  projectId,
  projectName,
}: {
  apiUrl: string;
  projectId: string;
  projectName: string;
}) {
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState(`Launch ${projectName}`);
  const [busy, setBusy] = useState(false);
  const { locale } = useLocale();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  async function decompose() {
    setBusy(true);
    setError(null);
    setResult(null);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setError("Your session expired. Refresh the page and sign in again.");
      setBusy(false);
      return;
    }

    try {
      const response = await fetch(`${apiUrl}/agents/planner/decompose`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ project_id: projectId, goal, language: locale }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.detail || `Request failed (${response.status})`);
      }
      setResult(
        `Created ${body.total_tasks} task${body.total_tasks === 1 ? "" : "s"} across ${body.groups.length} group${body.groups.length === 1 ? "" : "s"}.`,
      );
      router.refresh();
    } catch (err) {
      console.error("planner decomposition failed:", err);
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Icon name="auto_awesome" size={16} />
        Plan with AI
      </Button>
    );
  }

  return (
    <div className="relative space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
      {busy && <LoadingOverlay message="Breaking this goal into tasks..." />}
      <p className="text-xs text-muted-foreground">
        Describe the goal, the Planner agent breaks it into tasks and files them under this
        project.
      </p>
      <div className="flex gap-2">
        <Input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Goal to decompose"
          disabled={busy}
        />
        <Button size="sm" onClick={decompose} disabled={busy || !goal.trim()} className="gap-1.5">
          {busy && <Icon name="progress_activity" size={14} className="animate-spin" />}
          {busy ? "Planning..." : "Go"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
      {result && <p className="text-xs text-foreground">{result}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
