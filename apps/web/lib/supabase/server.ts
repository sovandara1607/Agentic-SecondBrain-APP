import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    // SUPABASE_URL, when set, overrides the browser-facing
    // NEXT_PUBLIC_SUPABASE_URL for this server-side client. Needed under
    // Docker Compose (Task 10): the browser reaches Supabase via the host's
    // published Kong port ("http://127.0.0.1:8000"), but that same URL is
    // unreachable from *inside* the web container - "localhost" there
    // resolves to the container itself, not the Kong container. See
    // infra/docker-compose.yml's web service for the container-internal value.
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Pin the auth cookie name explicitly - see the matching comment in
      // proxy.ts for why. Must match proxy.ts and client.ts.
      cookieOptions: { name: "sb-auth-token" },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll called from a Server Component, session refresh is
            // handled by middleware instead, safe to ignore here.
          }
        },
      },
    },
  );
}
