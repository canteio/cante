import { NextResponse } from "next/server";
import { DEMO_SESSION_COOKIE, DEMO_SESSION_VALUE } from "@/lib/auth/config";

const DEMO_USER = "ptma";
const DEMO_PASSWORD = "ptma";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid login request." }, { status: 400 });
  }

  const { username, password } = body as { username?: unknown; password?: unknown };
  if (username !== DEMO_USER || password !== DEMO_PASSWORD) {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(DEMO_SESSION_COOKIE, DEMO_SESSION_VALUE, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return response;
}

export async function DELETE() {
  // Wrapped in try/catch (Eng sweep, run 42): without this, an unexpected throw while
  // building the response/cookie would fall through to Next's default HTML error page
  // instead of clean JSON, breaking any API client/agent that expects JSON on this route.
  try {
    const response = NextResponse.json({ ok: true });
    response.cookies.set(DEMO_SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    console.error("DELETE /api/demo-login failed:", error);
    return NextResponse.json({ error: "Failed to log out of demo session." }, { status: 500 });
  }
}
