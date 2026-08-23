import { NextResponse } from "next/server";
import { DEMO_SESSION_COOKIE, getAuthMode, hasSupabaseEnv } from "@/lib/auth/config";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
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
}
