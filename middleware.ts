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
  "/tariff",
];

const PUBLIC_API_PATHS = new Set(["/api/demo-login", "/api/logout", "/api/waitlist"]);

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // MVP: archived pages remain in the repository, but their old entry points
  // redirect to the focused import workflow. No old page component is executed.
  const archivedPages = ["/chat", "/checklist", "/checks", "/documents", "/memory", "/profile", "/suppliers", "/workqueue", "/import-monitor", "/onboarding"];
  if (archivedPages.some(path => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.redirect(new URL("/tariff", request.url));
  }
  const isProtectedPage = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  // The tariff-recalculate cron bridge is
  // called by Supabase Edge Functions on a schedule, never by a logged-in
  // browser -- it carries its own shared-secret auth
  // inside the route handler itself (see app/api/internal/tariff-recalculate
  // /route.ts) and must never go through this cookie-session gate, which
  // would reject every legitimate scheduled call with 401 before the
  // route's real auth check ever runs.
  const isInternalApi = pathname === "/api/internal/tariff-recalculate";
  const isProtectedApi = pathname.startsWith("/api/") && !isInternalApi && !PUBLIC_API_PATHS.has(pathname);
  const isProtected = isProtectedPage || isProtectedApi;

  if (!isProtected) {
    return NextResponse.next();
  }

  if (getAuthMode() === "supabase") {
    const { response, userIsAuthenticated, workspace } = await updateSupabaseSession(request);
    if (userIsAuthenticated && workspace) {
      // MVP: legacy API entry points are disabled; implementations remain intact.
      const archivedApis = ["/api/chat", "/api/checklist", "/api/checks", "/api/memories", "/api/documents", "/api/workqueue", "/api/screening", "/api/substances", "/api/import-monitor", "/api/onboarding"];
      if (archivedApis.some(path => pathname === path || pathname.startsWith(`${path}/`))) {
        return NextResponse.json({ error: "This feature is archived. Use Products and Imports & results." }, { status: 410 });
      }
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
    "/tariff/:path*",
    "/api/:path*",
  ],
};
