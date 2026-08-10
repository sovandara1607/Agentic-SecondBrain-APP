"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
        body: JSON.stringify({ project_id: projectId, goal }),
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
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Sparkles />
        Plan with AI
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
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
        <Button size="sm" onClick={decompose} disabled={busy || !goal.trim()}>
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
