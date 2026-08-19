"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Icon } from "@/components/ui/icon";
import { LoadingOverlay } from "@/components/loading-overlay";
import { friendlyError } from "@/lib/friendly-error";
import { useLocale } from "@/lib/i18n/locale-provider";

const DOC_TYPES = [
  { value: "document", label: "Document" },
  { value: "email", label: "Email" },
  { value: "report", label: "Report" },
  { value: "presentation_outline", label: "Presentation outline" },
];

export function WriterButton({ apiUrl }: { apiUrl: string }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [docType, setDocType] = useState("document");
  const [busy, setBusy] = useState(false);
  const { locale } = useLocale();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  async function draft() {
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
      const response = await fetch(`${apiUrl}/agents/writer/draft`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ prompt, doc_type: docType, language: locale }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.detail || `Request failed (${response.status})`);
      }
      setOpen(false);
      setPrompt("");
      router.push(`/notes/${body.note_id}`);
      router.refresh();
    } catch (err) {
      console.error("writer draft failed:", err);
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <Icon name="edit_note" size={16} />
        Draft with AI
      </Button>
    );
  }

  return (
    <div className="relative w-full space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3 sm:w-auto sm:min-w-96">
      {busy && <LoadingOverlay message="Drafting from your notes and projects..." />}
      <p className="text-xs text-muted-foreground">
        The Writer agent drafts from your existing notes and projects, then saves the result as a
        new note.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="What should it draft? e.g. 'investor update for MyLMS'"
          disabled={busy}
          className="flex-1"
        />
        <Select
          value={docType}
          onChange={(e) => setDocType(e.target.value)}
          disabled={busy}
          className="w-full sm:w-44"
        >
          {DOC_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={draft} disabled={busy || !prompt.trim()} className="gap-1.5">
          {busy && <Icon name="progress_activity" size={14} className="animate-spin" />}
          {busy ? "Drafting..." : "Draft"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
