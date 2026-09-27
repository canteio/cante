import {
  approveClassification,
  ClassificationApprovalError,
  listClassifications,
  recordClassification,
  rejectClassification,
  resolveProductCodes,
} from "@/lib/catalogue/classifications";
import type { HsCodeTier } from "@/lib/checks/facts";
import { CLASSIFICATION_TIERS } from "@/lib/catalogue/classifications-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The classification workspace — item 6.
 *
 * POST records a proposal; PATCH approves or rejects. There is deliberately no
 * way to write an approved row in one call: approval carries a named approver
 * and a written rationale, and the split makes that structural rather than
 * merely conventional.
 */

const TIERS = new Set<string>(CLASSIFICATION_TIERS);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");
  if (!productId) return Response.json({ error: "productId is required." }, { status: 400 });

  const system = url.searchParams.get("system");
  const jurisdiction = url.searchParams.get("jurisdiction");

  return Response.json({
    history: listClassifications(productId),
    ...(system ? { resolved: resolveProductCodes(productId, system, jurisdiction) } : {}),
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const payload = body as Record<string, unknown>;

  const productId = payload.productId as string;
  const system = payload.system as string;
  const code = payload.code as string;
  const tier = payload.tier as string;
  const basis = payload.basis as string;

  if (!productId || !system || !code || !basis) {
    return Response.json(
      { error: "productId, system, code and basis are required." },
      { status: 400 },
    );
  }
  if (!TIERS.has(tier)) {
    return Response.json(
      { error: `tier must be one of document, human, lead, guess — got "${tier}".` },
      { status: 400 },
    );
  }
  if (tier === "document") {
    // The document tier means "read off a real document". It is produced by the
    // document-audit path, which can cite the paperwork; letting an arbitrary
    // POST claim it would reopen the exact laundering hole facts.ts closed.
    return Response.json(
      {
        error:
          "document-tier codes cannot be asserted directly. Upload the document to /api/documents and promote from it.",
      },
      { status: 400 },
    );
  }

  const row = recordClassification({
    productId,
    system,
    code,
    tier: tier as HsCodeTier,
    basis,
    jurisdiction: (payload.jurisdiction as string) ?? null,
    rationale: (payload.rationale as string) ?? null,
  });
  return Response.json({ classification: row });
}

export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const payload = body as Record<string, unknown>;
  const id = payload.classificationId as string;
  if (!id) return Response.json({ error: "classificationId is required." }, { status: 400 });

  try {
    if (payload.action === "reject") {
      const reason = (payload.reason as string) ?? "";
      if (!reason.trim()) {
        return Response.json({ error: "Rejecting requires a reason." }, { status: 400 });
      }
      rejectClassification(id, reason);
      return Response.json({ ok: true });
    }

    const classification = approveClassification(
      id,
      (payload.approvedBy as string) ?? "",
      (payload.rationale as string) ?? "",
    );
    return Response.json({ classification });
  } catch (error) {
    if (error instanceof ClassificationApprovalError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "Could not update the classification." }, { status: 500 });
  }
}
