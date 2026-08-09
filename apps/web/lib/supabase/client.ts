import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Pin the auth cookie name explicitly - see the matching comment in
      // proxy.ts for why. Must match proxy.ts and server.ts.
      cookieOptions: { name: "sb-auth-token" },
    },
  );
}
