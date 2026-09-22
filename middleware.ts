import { NextRequest, NextResponse } from "next/server";
import {
  DEMO_SESSION_COOKIE,
  DEMO_SESSION_VALUE,
  getAuthMode,
} from "@/lib/auth/config";
import { updateSupabaseSession } from "@/lib/supabase/middleware";

// Onboarding uses the same workspace gate; existing login destinations stay unchanged.
const PROTECTED_PREFIXES = [
  "/onboarding",
  "/catalogue",
  "/chat",
  "/checklist",
  "/checks",
  "/documents",
  "/memory",
  "/profile",
  "/suppliers",
  "/workqueue",
  "/import-monitor",
];

const PUBLIC_API_PATHS = new Set(["/api/demo-login", "/api/logout", "/api/waitlist"]);

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isProtectedPage = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  const isProtectedApi = pathname.startsWith("/api/") && !PUBLIC_API_PATHS.has(pathname);
  const isProtected = isProtectedPage || isProtectedApi;

  if (!isProtected) {
    return NextResponse.next();
  }

  if (getAuthMode() === "supabase") {
    const { response, userIsAuthenticated, workspace } = await updateSupabaseSession(request);
    if (userIsAuthenticated && workspace) {
      if (isProtectedApi && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
        const origin = request.headers.get("origin");
        if (origin && origin !== request.nextUrl.origin) {
          return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
        }
      }
      return response;
    }
    if (isProtectedApi) {
      return NextResponse.json(
        { error: userIsAuthenticated ? "No workspace access." : "Authentication required." },
        { status: userIsAuthenticated ? 403 : 401 },
      );
    }
    if (userIsAuthenticated) {
      const pendingUrl = request.nextUrl.clone();
      pendingUrl.pathname = "/pending";
      pendingUrl.search = "";
      return NextResponse.redirect(pendingUrl);
    }
  } else {
    const session = request.cookies.get(DEMO_SESSION_COOKIE)?.value;
    if (session === DEMO_SESSION_VALUE) {
      return NextResponse.next();
    }
    if (isProtectedApi) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/onboarding/:path*",
    "/catalogue/:path*",
    "/chat/:path*",
    "/checklist/:path*",
    "/checks/:path*",
    "/documents/:path*",
    "/memory/:path*",
    "/profile/:path*",
    "/suppliers/:path*",
    "/workqueue/:path*",
    "/import-monitor/:path*",
    "/api/:path*",
  ],
};
