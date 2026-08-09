import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-semibold">Agentic Second Brain</h1>
        <p className="text-sm text-muted-foreground">
          Capture everything. Let the agents organize it.
        </p>
      </div>
      <div className="flex gap-3">
        <Link href="/signup">
          <Button>Sign up</Button>
        </Link>
        <Link href="/login">
          <Button variant="outline">Log in</Button>
        </Link>
      </div>
    </main>
  );
}
