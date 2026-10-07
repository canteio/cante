import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Capture the actual transport before tests replace fetch for external services.
const realFetch = globalThis.fetch.bind(globalThis);
export async function createClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!,
    { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: realFetch } },
  );
}

export async function getAuthenticatedWorkspace(requestedCustomerId?: string | null) {
  const { testWorkspace } = await import("./supabase-test-db");
  return testWorkspace(requestedCustomerId);
}

export async function retrieveCustomerContext(input: {
  customerId: string; jurisdiction: string; query: string; limit?: number;
}) {
  const client = await createClient();
  const { data, error } = await client.rpc("search_cante_context", {
    query_text: input.query, target_customer_id: input.customerId,
    target_jurisdiction: input.jurisdiction, match_count: input.limit ?? 10,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: Number(row.id), documentId: row.document_id ?? null,
    pageNumber: row.page_number ?? null, heading: row.heading ?? null,
    content: String(row.content ?? ""), rank: Number(row.rank ?? 0),
  }));
}

export const createRequestClient = createClient;
