import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Next.js 16 renamed the `middleware.ts` file convention to `proxy.ts` (the
// `middleware` export is now `proxy`); functionality is unchanged. See
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    // See the matching comment in lib/supabase/server.ts: this proxy runs
    // server-side inside the web container under Docker Compose, so it needs
    // the container-internal Supabase URL, not the browser-facing one.
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Pin the auth cookie name explicitly. @supabase/ssr otherwise derives
      // it from the client's own supabaseUrl hostname (`sb-<hostname>-auth-token`),
      // which would differ between the browser client (NEXT_PUBLIC_SUPABASE_URL,
      // "localhost") and this server-side client (SUPABASE_URL, "kong" under
      // Docker Compose) - a mismatch that makes the server unable to find the
      // cookie the browser set. Must match lib/supabase/client.ts and server.ts.
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
