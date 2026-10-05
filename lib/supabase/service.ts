import { createClient } from "@supabase/supabase-js";

// Capture the real transport at module load, before any caller (tests
// mocking fetch for an external API, or a future runtime wrapper) can
// replace globalThis.fetch — database traffic must never be redirected by
// an unrelated mock, matching the pattern already established in
// lib/test-support/supabase-test-server.ts.
const realFetch = globalThis.fetch.bind(globalThis);

/**
 * Server-only trusted worker client; never import into client bundles or request
 * handlers. The secret bypasses RLS, so worker callers must explicitly scope
 * tenant operations. No cookies/session or database search_path changes needed.
 */
export function createServiceClient() {
  if (typeof window !== "undefined") throw new Error("The Supabase service client is server-only.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) {
    throw new Error("Worker requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).");
  }
  return createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: realFetch },
  });
}
