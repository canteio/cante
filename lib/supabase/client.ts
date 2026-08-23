import { createBrowserClient } from "@supabase/ssr";
import { requireSupabaseEnv } from "@/lib/auth/config";

export function createClient() {
  const { publishableKey, url } = requireSupabaseEnv();
  return createBrowserClient(url, publishableKey);
}
