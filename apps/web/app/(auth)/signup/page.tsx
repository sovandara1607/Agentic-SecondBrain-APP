"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { GitHubOAuthButton } from "@/components/github-oauth-button";
import { friendlyError } from "@/lib/friendly-error";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
      console.error("signup failed:", error);
      setError(friendlyError(error));
      setBusy(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
    // Deliberately not resetting busy here - this page is about to
    // navigate away, a button flipping back to "Sign up" for one frame
    // first would just be a flash of the wrong state.
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <form onSubmit={handleSubmit} className="w-80 space-y-4">
        <h1 className="text-xl font-semibold">Create your account</h1>
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
          minLength={6}
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <Button type="submit" className="w-full gap-1.5" disabled={busy}>
          {busy && <Icon name="progress_activity" size={16} className="animate-spin" />}
          {busy ? "Signing up..." : "Sign up"}
        </Button>
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">or</span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <GitHubOAuthButton />
      </form>
    </main>
  );
}
