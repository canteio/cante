import { NextResponse } from "next/server";
import { DEMO_SESSION_COOKIE, getAuthMode, hasSupabaseEnv } from "@/lib/auth/config";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  // try/catch added: createClient()/signOut() can throw (e.g. Supabase env
  // misconfigured or network error) and without this the route falls through
  // to Next's default HTML error page instead of clean JSON — breaks any API
  // client/agent parsing the response (same fix pattern as lanes DELETE).
  try {
    const response = NextResponse.json({ ok: true });

    response.cookies.set(DEMO_SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });

    if (getAuthMode() === "supabase" && hasSupabaseEnv()) {
      const supabase = await createClient();
      await supabase.auth.signOut();
    }

    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to log out." },
      { status: 500 },
    );
  }
}
