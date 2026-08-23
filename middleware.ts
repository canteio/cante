import { NextRequest, NextResponse } from "next/server";
import {
  DEMO_SESSION_COOKIE,
  DEMO_SESSION_VALUE,
  emailIsAllowed,
  getAuthMode,
} from "@/lib/auth/config";
import { updateSupabaseSession } from "@/lib/supabase/middleware";

const PROTECTED_PREFIXES = [
  "/catalogue",
  "/chat",
  "/checklist",
  "/checks",
  "/documents",
  "/memory",
  "/profile",
  "/suppliers",
  "/workqueue",
];

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (!isProtected) {
    return NextResponse.next();
  }

  if (getAuthMode() === "supabase") {
    const { email, response, userIsAuthenticated } = await updateSupabaseSession(request);
    if (userIsAuthenticated && emailIsAllowed(email)) {
      return response;
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
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/catalogue/:path*",
    "/chat/:path*",
    "/checklist/:path*",
    "/checks/:path*",
    "/documents/:path*",
    "/memory/:path*",
    "/profile/:path*",
    "/suppliers/:path*",
    "/workqueue/:path*",
  ],
};
