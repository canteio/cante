import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { hasSupabaseEnv, requireSupabaseEnv } from "@/lib/auth/config";

export async function updateSupabaseSession(request: NextRequest) {
  if (!hasSupabaseEnv()) {
    return {
      response: NextResponse.next({ request }),
      userIsAuthenticated: false,
    };
  }

  const { publishableKey, url } = requireSupabaseEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, options, value }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  return {
    email:
      typeof claims?.email === "string"
        ? claims.email
        : typeof claims?.user_metadata === "object" &&
            claims.user_metadata &&
            "email" in claims.user_metadata &&
            typeof claims.user_metadata.email === "string"
          ? claims.user_metadata.email
          : null,
    response,
    userIsAuthenticated: Boolean(claims && !error),
  };
}
