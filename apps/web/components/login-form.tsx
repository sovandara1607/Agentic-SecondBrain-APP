"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { GitHubOAuthButton } from "@/components/github-oauth-button";
import { friendlyError } from "@/lib/friendly-error";

type LoginFormProps = {
  initialError?: string | null;
};

export function LoginForm({ initialError = null }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      console.error("login failed:", error);
      setError(friendlyError(error));
      setBusy(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
    // Not resetting busy here - about to navigate away.
  }

  return (
    <form onSubmit={handleSubmit} className="w-80 space-y-4">
      <h1 className="text-xl font-semibold">Log in</h1>
      <Input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <Input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && <p className="text-sm text-red-500">{error}</p>}
      <Button type="submit" className="w-full gap-1.5" disabled={busy}>
        {busy && <Icon name="progress_activity" size={16} className="animate-spin" />}
        {busy ? "Logging in..." : "Log in"}
      </Button>
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">or</span>
        <div className="h-px flex-1 bg-border" />
      </div>
      <GitHubOAuthButton />
    </form>
  );
}
