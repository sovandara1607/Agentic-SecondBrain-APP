"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Icon } from "@/components/ui/icon";
import { LoadingOverlay } from "@/components/loading-overlay";
import { friendlyError } from "@/lib/friendly-error";
import { useLocale } from "@/lib/i18n/locale-provider";

export function ResearchButton({ apiUrl }: { apiUrl: string }) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [urlsText, setUrlsText] = useState("");
  const [busy, setBusy] = useState(false);
  const { locale } = useLocale();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  async function research() {
    const urls = urlsText
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);
    if (!urls.length) {
      setError("Add at least one source URL, one per line.");
      return;
    }

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
      const response = await fetch(`${apiUrl}/agents/research/synthesize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ topic, urls, language: locale }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.detail || `Request failed (${response.status})`);
      }
      setOpen(false);
      setTopic("");
      setUrlsText("");
      router.push(`/notes/${body.note_id}`);
      router.refresh();
    } catch (err) {
      console.error("research synthesis failed:", err);
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <Icon name="travel_explore" size={16} />
        Research
      </Button>
    );
  }

  return (
    <div className="relative w-full space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3 sm:w-96">
      {busy && <LoadingOverlay message="Fetching and comparing sources..." />}
      <p className="text-xs text-muted-foreground">
        The Research agent fetches each source, compares what they say, and saves a synthesized
        note.
      </p>
      <Input
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        placeholder="Research topic"
        disabled={busy}
      />
      <Textarea
        value={urlsText}
        onChange={(e) => setUrlsText(e.target.value)}
        placeholder={"One source URL per line, up to 6\nhttps://...\nhttps://..."}
        rows={3}
        disabled={busy}
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={research} disabled={busy || !topic.trim()} className="gap-1.5">
          {busy && <Icon name="progress_activity" size={14} className="animate-spin" />}
          {busy ? "Researching..." : "Go"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
