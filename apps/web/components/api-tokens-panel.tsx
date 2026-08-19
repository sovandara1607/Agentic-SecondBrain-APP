"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import {
  createApiToken,
  revokeApiToken,
  type CreateApiTokenState,
} from "@/app/(app)/settings/actions";

type ApiToken = {
  id: string;
  name: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

const INITIAL_STATE: CreateApiTokenState = { token: null, error: null };

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="gap-1.5"
    >
      <Icon name={copied ? "check" : "content_copy"} size={14} />
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

export function ApiTokensPanel({ tokens }: { tokens: ApiToken[] }) {
  const [state, formAction, pending] = useActionState(createApiToken, INITIAL_STATE);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Personal access tokens let a script call{" "}
        <code className="rounded bg-muted px-1 py-0.5">POST /captures</code> to add captures from
        outside the app. Each token is shown once, right after creation.
      </p>

      {state.token ? (
        <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
            <Icon name="warning" size={14} />
            Copy this now - you won&apos;t be able to see it again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border border-border bg-background px-2.5 py-1.5 text-xs">
              {state.token}
            </code>
            <CopyButton text={state.token} />
          </div>
        </div>
      ) : null}
      {state.error && <p className="text-xs text-destructive">{state.error}</p>}

      <form action={formAction} className="flex gap-2">
        <Input name="name" placeholder="Token name, e.g. 'laptop script'" disabled={pending} />
        <Button type="submit" disabled={pending} className="shrink-0">
          {pending ? "Creating..." : "New token"}
        </Button>
      </form>

      {tokens.length ? (
        <ul className="space-y-1.5">
          {tokens.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-2.5 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{t.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  <code>{t.token_prefix}&hellip;</code> &middot; created{" "}
                  {new Date(t.created_at).toLocaleDateString()}
                  {t.last_used_at && ` · last used ${new Date(t.last_used_at).toLocaleDateString()}`}
                </p>
              </div>
              {t.revoked_at ? (
                <Badge variant="muted" className="shrink-0">
                  Revoked
                </Badge>
              ) : (
                <form action={revokeApiToken}>
                  <input type="hidden" name="id" value={t.id} />
                  <Button type="submit" size="sm" variant="ghost" className="shrink-0 text-destructive">
                    Revoke
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground italic">No tokens yet.</p>
      )}
    </div>
  );
}
