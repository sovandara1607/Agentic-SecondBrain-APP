"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";

export function ReprocessButton({ apiUrl, captureId }: { apiUrl: string; captureId: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const supabase = createClient();
  const toast = useToast();

  async function reprocess() {
    setBusy(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        toast("Your session has expired. Please sign in again.");
        return;
      }

      const response = await fetch(`${apiUrl}/captures/${captureId}/reprocess`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (response.ok) {
        router.refresh();
      } else {
        // Previously silent on failure - a captures list "reprocess" that
        // does nothing visible reads as broken, not just unlucky.
        const body = await response.json().catch(() => null);
        console.error("reprocess failed:", body);
        toast(friendlyError(body?.detail ?? `Request failed (${response.status})`));
      }
    } catch (err) {
      console.error("reprocess failed:", err);
      toast(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={reprocess}
      disabled={busy}
      aria-label="Reprocess capture"
      title="Re-run the pipeline on this capture"
      className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
    >
      <Icon name="refresh" size={16} className={busy ? "animate-spin" : undefined} />
    </button>
  );
}
