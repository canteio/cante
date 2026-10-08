import { cookies } from "next/headers";
import { resolveCustomerId } from "@/lib/db/queries";
import { getProvider, normalizeProviderChoice, PROVIDER_COOKIE } from "@/lib/llm";
import {
  adoptSuggestion,
  pendingSuggestions,
  recordSuggestion,
  suggestClassification,
  SuggestionError,
} from "@/lib/classification/suggest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Off by default. AI-suggested HTS classification carries real legal risk —
 * CBP ruling HQ H290535 treats classification beyond 6 digits as "customs
 * business" under 19 U.S.C., and this session's own test against real
 * product descriptions found the keyword-search retrieval step frequently
 * surfaces no correct candidate at all (confirmed: an Esun PLA filament
 * search never retrieved the real, CBP-ruling-backed 3916.90.30 heading).
 * The suggestion still can't become an approved classification without a
 * named human adopting it (see suggest.ts), but the feature is disabled in
 * production until that retrieval gap is addressed. Set
 * CANTE_CLASSIFICATION_SUGGEST_ENABLED=true to turn it on for testing.
 */
function classificationSuggestEnabled(): boolean {
  return process.env.CANTE_CLASSIFICATION_SUGGEST_ENABLED === "true";
}

/**
 * Model-suggested classifications.
 *
 * `POST { sku }` proposes a code and records it as an unconfirmed lead.
 * `PATCH { classificationId, adoptedBy, reason }` adopts it (lead → human),
 * which is the separate human act that makes approval possible at all.
 *
 * There is deliberately no endpoint that suggests and approves in one call.
 */

export async function GET(request: Request) {
  const url = new URL(request.url);
  const customerId = await resolveCustomerId(url.searchParams.get("customerId"));
  if (!customerId) return Response.json({ pending: [] });
  return Response.json({ pending: await pendingSuggestions(customerId) });
}

export async function POST(request: Request) {
  if (!classificationSuggestEnabled()) {
    return Response.json(
      { error: "Classification suggestion is disabled. Set CANTE_CLASSIFICATION_SUGGEST_ENABLED=true to enable for testing." },
      { status: 404 },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  // JSON primitives parse successfully, but they cannot satisfy the documented
  // request contract and must not fall through as uncaught property accesses.
  if (!isJsonObject(body)) {
    return Response.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }
  const payload = body;
  const customerId = await resolveCustomerId(payload.customerId as string | undefined);
  const sku = payload.sku as string;
  if (!customerId || !sku) {
    return Response.json({ error: "sku is required." }, { status: 400 });
  }

  const choice = normalizeProviderChoice((await cookies()).get(PROVIDER_COOKIE)?.value);
  const provider = getProvider(choice);

  try {
    const result = await suggestClassification(provider, { customerId, sku });
    const productId = payload.productId as string | undefined;
    const stored = productId ? await recordSuggestion(productId, result) : null;

    return Response.json({
      suggestion: result.suggestion,
      candidateCount: result.candidates.length,
      rulings: result.rulings,
      chosenRow: result.chosenRow,
      caveats: result.caveats,
      classification: stored,
    });
  } catch (error) {
    if (error instanceof SuggestionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Suggestion failed." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  // JSON primitives parse successfully, but they cannot satisfy the documented
  // request contract and must not fall through as uncaught property accesses.
  if (!isJsonObject(body)) {
    return Response.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }
  const payload = body;

  try {
    return Response.json({
      classification: await adoptSuggestion(
        payload.classificationId as string,
        (payload.adoptedBy as string) ?? "",
        (payload.reason as string) ?? "",
      ),
    });
  } catch (error) {
    if (error instanceof SuggestionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "Could not adopt the suggestion." }, { status: 500 });
  }
}
