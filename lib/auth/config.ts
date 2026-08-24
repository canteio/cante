export const DEMO_SESSION_COOKIE = "cante_demo_session";
export const DEMO_SESSION_VALUE = "ptma";

export type AuthMode = "demo" | "supabase";
export type DataBackend = "sqlite" | "supabase";

export function getAuthMode(): AuthMode {
  return process.env.CANTE_AUTH_MODE === "supabase" ? "supabase" : "demo";
}

export function getDataBackend(): DataBackend {
  return process.env.CANTE_DATA_BACKEND === "supabase" ? "supabase" : "sqlite";
}

export function hasSupabaseEnv() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export function requireSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Supabase auth is enabled, but NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing.",
    );
  }

  return { publishableKey, url };
}

export function emailIsAllowed(email: string | null | undefined) {
  const allowed = process.env.CANTE_ALLOWED_EMAILS?.split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (!allowed || allowed.length === 0) {
    return false;
  }

  return Boolean(email && allowed.includes(email.toLowerCase()));
}
