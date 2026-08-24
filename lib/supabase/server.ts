import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireSupabaseEnv } from "@/lib/auth/config";

export async function createClient() {
  const cookieStore = await cookies();
  const { publishableKey, url } = requireSupabaseEnv();

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
