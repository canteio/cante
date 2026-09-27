import { resolveCustomerId } from "@/lib/db/queries";
import { SUBSTANCES_ACTIONS } from "@/lib/substances/contract";
import {
  addComponent,
  assessRestrictions,
  componentTree,
  declareSubstance,
  deleteComponent,
  loadRestrictionList,
  productsContainingSubstanceNamedIn,
  upsertSubstance,
} from "@/lib/substances/bom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bill of materials, declared substances, and restriction checks.
 *
 * GET returns the assessment for the whole catalogue — including the
 * components nobody has declared anything about, which are the point.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const customerId = await resolveCustomerId(url.searchParams.get("customerId"));
  if (!customerId) return Response.json({ hits: [], undeclaredComponents: [], caveats: [] });

  const productId = url.searchParams.get("productId");
  const matchText = url.searchParams.get("matchText");

  return Response.json({
    assessment: assessRestrictions(customerId),
    ...(productId ? { components: componentTree(productId) } : {}),
    ...(matchText ? { substanceMatches: productsContainingSubstanceNamedIn(customerId, matchText) } : {}),
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
  const action = (payload.action as string) ?? "component";

  try {
    if (action === "component") {
      const productId = payload.productId as string;
      const name = payload.name as string;
      if (!productId || !name?.trim()) {
        return Response.json({ error: "productId and name are required." }, { status: 400 });
      }
      return Response.json({
        component: addComponent({
          productId,
          name,
          parentComponentId: (payload.parentComponentId as string) ?? null,
          partNumber: payload.partNumber as string | null,
          supplierId: (payload.supplierId as string) ?? null,
          quantity: typeof payload.quantity === "number" ? payload.quantity : null,
          unit: payload.unit as string | null,
          massGrams: typeof payload.massGrams === "number" ? payload.massGrams : null,
          notes: payload.notes as string | null,
        }),
      });
    }

    if (action === "declare") {
      const componentId = payload.componentId as string;
      const name = payload.substanceName as string;
      if (!componentId || !name?.trim()) {
        return Response.json(
          { error: "componentId and substanceName are required." },
          { status: 400 },
        );
      }
      const tier = (payload.tier as string) ?? "lead";
      if (tier === "document" && !payload.supplierDocumentId) {
        // Same rule as classification codes: the verified tier needs paperwork.
        return Response.json(
          {
            error:
              "A document-tier declaration must cite the supplier document it came from (supplierDocumentId).",
          },
          { status: 400 },
        );
      }
      const substance = upsertSubstance({
        name,
        casNumber: (payload.casNumber as string) ?? null,
        ecNumber: (payload.ecNumber as string) ?? null,
        synonyms: Array.isArray(payload.synonyms) ? (payload.synonyms as string[]) : [],
      });
      return Response.json({
        substance,
        declaration: declareSubstance({
          componentId,
          substanceId: substance.id,
          concentrationPpm:
            typeof payload.concentrationPpm === "number" ? payload.concentrationPpm : null,
          tier,
          basis: (payload.basis as string) ?? "entered manually",
          supplierDocumentId: (payload.supplierDocumentId as string) ?? null,
        }),
      });
    }

    if (action === "load_list") {
      const name = payload.name as string;
      const jurisdiction = payload.jurisdiction as string;
      const entries = payload.entries;
      if (!name || !jurisdiction || !Array.isArray(entries)) {
        return Response.json(
          { error: "name, jurisdiction and entries[] are required." },
          { status: 400 },
        );
      }
      return Response.json({
        listId: loadRestrictionList({
          name,
          jurisdiction,
          authority: payload.authority as string | null,
          version: payload.version as string | null,
          sourceUrl: payload.sourceUrl as string | null,
          entries: entries as Parameters<typeof loadRestrictionList>[0]["entries"],
        }),
      });
    }

    return Response.json(
      { error: `Unknown action "${action}".`, validActions: SUBSTANCES_ACTIONS },
      { status: 400 },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Request failed." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  // Same try/catch sweep as POST above: without this, a thrown error from
  // deleteComponent (e.g. an FK constraint on a component still referenced
  // by declared substances) would fall through to an HTML error page
  // instead of clean JSON, breaking any API client/agent parsing the response.
  try {
    const componentId = new URL(request.url).searchParams.get("componentId");
    if (!componentId) return Response.json({ error: "componentId is required." }, { status: 400 });
    deleteComponent(componentId);
    return Response.json({ deleted: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Request failed." },
      { status: 500 },
    );
  }
}
