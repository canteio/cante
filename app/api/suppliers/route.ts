import { getDefaultCustomerId } from "@/lib/db/queries";
import { listSuppliers, upsertSupplier } from "@/lib/catalogue/lanes";
import {
  EvidenceError,
  evidenceGaps,
  listSupplierDocuments,
  requestEvidence,
  suggestedEvidence,
  upsertEvidence,
  type EvidenceStatus,
} from "@/lib/suppliers/evidence";
import { latestScreening, screenSupplier, screeningCoverage } from "@/lib/screening/persist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Suppliers, their evidence (item 9), and their screening status (item 10).
 *
 * GET returns coverage alongside the rows on purpose: a list of suppliers we
 * have screened says nothing about the ones we have not, and `neverScreened` is
 * the number that actually matters.
 */

export async function GET(request: Request) {
  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId") ?? (await getDefaultCustomerId());
  if (!customerId) return Response.json({ suppliers: [] });

  const suppliers = listSuppliers(customerId).map((supplier) => ({
    ...supplier,
    documents: listSupplierDocuments(supplier.id),
    latestScreening: latestScreening(supplier.id) ?? null,
  }));

  return Response.json({
    suppliers,
    gaps: evidenceGaps(customerId),
    suggestions: suggestedEvidence(customerId),
    screeningCoverage: screeningCoverage(customerId),
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
  const customerId = (payload.customerId as string) ?? (await getDefaultCustomerId());
  if (!customerId) return Response.json({ error: "No customer." }, { status: 400 });

  const action = (payload.action as string) ?? "upsert";

  try {
    if (action === "upsert") {
      const name = payload.name as string;
      if (!name?.trim()) return Response.json({ error: "name is required." }, { status: 400 });
      return Response.json({
        supplier: upsertSupplier(
          customerId,
          {
            name,
            country: payload.country as string | null,
            address: payload.address as string | null,
            contactEmail: payload.contactEmail as string | null,
            role: payload.role as string | null,
            notes: payload.notes as string | null,
          },
          (payload.supplierId as string) ?? undefined,
        ),
      });
    }

    if (action === "evidence") {
      const supplierId = payload.supplierId as string;
      const docType = payload.docType as string;
      if (!supplierId || !docType) {
        return Response.json({ error: "supplierId and docType are required." }, { status: 400 });
      }
      return Response.json({
        document: upsertEvidence({
          supplierId,
          docType,
          productId: (payload.productId as string) ?? null,
          status: payload.status as EvidenceStatus,
          expiresAt: payload.expiresAt as string | null,
          fileRef: payload.fileRef as string | null,
          notes: payload.notes as string | null,
        }),
      });
    }

    if (action === "request") {
      const supplierId = payload.supplierId as string;
      const docType = payload.docType as string;
      if (!supplierId || !docType) {
        return Response.json({ error: "supplierId and docType are required." }, { status: 400 });
      }
      // `delivered: false` travels with the response. The UI must not render
      // this as "sent" — nothing was sent.
      return Response.json(requestEvidence(supplierId, docType, (payload.productId as string) ?? null));
    }

    if (action === "screen") {
      const supplierId = payload.supplierId as string;
      if (!supplierId) return Response.json({ error: "supplierId is required." }, { status: 400 });
      const result = await screenSupplier(customerId, supplierId);
      return Response.json(result);
    }

    return Response.json({ error: `Unknown action "${action}".` }, { status: 400 });
  } catch (error) {
    if (error instanceof EvidenceError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Request failed." },
      { status: 500 },
    );
  }
}
