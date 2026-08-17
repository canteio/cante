import { cookies } from "next/headers";
import { getDefaultCustomerId } from "@/lib/db/queries";
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
  const customerId = url.searchParams.get("customerId") ?? (await getDefaultCustomerId());
  if (!customerId) return Response.json({ pending: [] });
  return Response.json({ pending: pendingSuggestions(customerId) });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const payload = body as Record<string, unknown>;
  const customerId = (payload.customerId as string) ?? (await getDefaultCustomerId());
  const sku = payload.sku as string;
  if (!customerId || !sku) {
    return Response.json({ error: "sku is required." }, { status: 400 });
  }

  const choice = normalizeProviderChoice((await cookies()).get(PROVIDER_COOKIE)?.value);
  const provider = getProvider(choice);

  try {
    const result = await suggestClassification(provider, { customerId, sku });
    const productId = payload.productId as string | undefined;
    const stored = productId ? recordSuggestion(productId, result) : null;

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
  const payload = body as Record<string, unknown>;

  try {
    return Response.json({
      classification: adoptSuggestion(
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
