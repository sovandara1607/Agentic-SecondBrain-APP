import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Next.js 16 renamed the `middleware.ts` file convention to `proxy.ts` (the
// `middleware` export is now `proxy`); functionality is unchanged. See
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
export async function proxy(request: NextRequest) {
  // Blanket kill switch for the whole app, gated purely by an env var
  // (no DB flag, no admin toggle UI) - this is a single-operator VPS
  // deployment (Section 18), so "set MAINTENANCE_MODE=true and recreate
  // the web container" is the right amount of ceremony, not a missing
  // feature. Checked before the Supabase session refresh below on
  // purpose: maintenance mode needs to work even when Supabase itself
  // is what's down, so this can't depend on that call succeeding.
  if (process.env.MAINTENANCE_MODE === "true" && request.nextUrl.pathname !== "/maintenance") {
    return NextResponse.rewrite(new URL("/maintenance", request.url));
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    // See the matching comment in lib/supabase/server.ts: this proxy runs
    // server-side inside the web container under Docker Compose, so it needs
    // the container-internal Supabase URL, not the browser-facing one.
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Pin the auth cookie name explicitly. @supabase/ssr otherwise derives
      // it from the client's own supabaseUrl hostname (`sb-<hostname>-auth-token`).
      // Pinning keeps the browser client and this server-side client aligned
      // even though Docker uses different Supabase URLs outside vs. inside the
      // container. Must match lib/supabase/client.ts and server.ts.
      cookieOptions: { name: "sb-auth-token" },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
