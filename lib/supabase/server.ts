import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireSupabaseEnv } from "@/lib/auth/config";

/**
 * CLI/cron scripts (scripts/run-check.ts, scripts/scheduled-check.ts) import
 * this same lib/db/queries.ts used by every web route, but have no HTTP
 * request to read cookies from — Next's `cookies()` throws
 * "called outside a request scope" the instant it's touched outside a real
 * request. Falling back to the trusted service-role client (no cookies,
 * bypasses RLS) keeps every queries.ts function usable from both contexts
 * without duplicating each one. This is safe here specifically because
 * nothing in queries.ts trusts a caller-supplied customerId as an identity
 * claim — CLI callers already pass an explicit customerId resolved from
 * CANTE_CUSTOMER_ID or db:seed, never from untrusted request input, and the
 * one place that *does* derive identity from auth (getAuthenticatedWorkspace
 * below) correctly reads an empty claims set from the fallback client and
 * returns null, exactly as it should with no signed-in user.
 */
export async function createRequestClient() {
  const { publishableKey, url } = requireSupabaseEnv();
  const cookieStore = await cookies();
  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, options, value }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies. Middleware refreshes them.
        }
      },
    },
  });
}

export async function createClient() {
  try {
    return await createRequestClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("outside a request scope")) throw error;
    const { createServiceClient } = await import("@/lib/supabase/service");
    return createServiceClient();
  }
}

export type AuthenticatedWorkspace = {
  customerId: string;
  role: "owner" | "admin" | "member" | "viewer";
  userId: string;
};

/**
 * Resolve tenancy from the verified Supabase session, never from request JSON.
 * A requested customer is accepted only when the signed-in user belongs to it.
 */
export async function getAuthenticatedWorkspace(
  requestedCustomerId?: string | null,
): Promise<AuthenticatedWorkspace | null> {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
  if (!userId || claimsError) return null;

  let query = supabase
    .from("customer_users")
    .select("customer_id, role")
    .eq("user_id", userId);
  if (requestedCustomerId) query = query.eq("customer_id", requestedCustomerId);

  const { data: membership, error } = await query.limit(1).maybeSingle();
  if (error || !membership) return null;

  return {
    customerId: membership.customer_id as string,
    role: membership.role as AuthenticatedWorkspace["role"],
    userId,
  };
}

export type RetrievedContextChunk = {
  id: number;
  documentId: string | null;
  pageNumber: number | null;
  heading: string | null;
  content: string;
  rank: number;
};

/** Keyword retrieval works immediately; vector retrieval joins it after embeddings are populated. */
export async function retrieveCustomerContext(input: {
  customerId: string;
  jurisdiction: string;
  query: string;
  limit?: number;
}): Promise<RetrievedContextChunk[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_cante_context", {
    query_text: input.query,
    target_customer_id: input.customerId,
    target_jurisdiction: input.jurisdiction,
    match_count: input.limit ?? 10,
  });
  if (error) throw new Error(`Supabase context retrieval failed: ${error.message}`);
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: Number(row.id),
    documentId: typeof row.document_id === "string" ? row.document_id : null,
    pageNumber: typeof row.page_number === "number" ? row.page_number : null,
    heading: typeof row.heading === "string" ? row.heading : null,
    content: String(row.content ?? ""),
    rank: Number(row.rank ?? 0),
  }));
}
