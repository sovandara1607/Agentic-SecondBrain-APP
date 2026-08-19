"use client";

import { useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { friendlyError } from "@/lib/friendly-error";
import { useLocale } from "@/lib/i18n/locale-provider";

type Proposal = {
  id: string;
  project_id: string;
  project_name: string;
  issue: string;
  proposed_action: string;
};

export function WorkflowCheckButton({ apiUrl }: { apiUrl: string }) {
  const [busy, setBusy] = useState(false);
  const { locale } = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    proposals: Proposal[];
    projectsChecked: number;
  } | null>(null);
  const supabase = createClient();

  async function check() {
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
      const response = await fetch(`${apiUrl}/agents/workflow/check`, {
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
      setResult({ proposals: body.proposals, projectsChecked: body.projects_checked });
    } catch (err) {
      console.error("workflow check failed:", err);
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" onClick={check} disabled={busy} className="gap-1.5">
        <Icon name={busy ? "progress_activity" : "fact_check"} size={16} className={busy ? "animate-spin" : undefined} />
        {busy ? "Checking..." : "Check projects"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {result && (
        <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
          {result.proposals.length ? (
            result.proposals.map((p) => (
              <div key={p.id} className="space-y-0.5 border-b border-border/40 pb-2 last:border-0 last:pb-0">
                <p className="text-sm font-medium">{p.project_name}</p>
                <p className="text-xs text-muted-foreground">{p.issue}</p>
                <p className="flex items-center gap-1 text-xs text-primary">
                  <Icon name="arrow_forward" size={12} />
                  {p.proposed_action}
                </p>
              </div>
            ))
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon name="check_circle" size={14} />
              Checked {result.projectsChecked} active project
              {result.projectsChecked === 1 ? "" : "s"} - nothing needs attention.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
