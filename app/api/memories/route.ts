import {
  addMemory,
  deleteMemory,
  getMemory,
  listMemories,
  resolveCustomerId,
  setMemoryConfirmed,
} from "@/lib/db/queries";
import { refreshChecklistForCustomer } from "@/lib/checks/checklist";
import { normalizeJurisdiction } from "@/lib/countries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = [
  "product",
  "hs_code",
  "naics",
  "material",
  "process",
  "waste",
  "distribution_state",
  "label_claim",
  "export_classification",
  "product_flag",
  "kbli",
  "market",
  "location",
  "license",
  "sni",
  "tax",
  "contact",
  "operational",
  "preference",
  "other",
];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const customerId = await resolveCustomerId(url.searchParams.get("customerId"));
  if (!customerId) return Response.json({ memories: [] });
  const jurisdiction = normalizeJurisdiction(url.searchParams.get("country"));
  return Response.json({ jurisdiction, memories: await listMemories(customerId, jurisdiction) });
}

/** POST — add a memory by hand. Anything typed here is confirmed by definition:
 *  a person entered it deliberately. Model-proposed entries come in via the
 *  chat route and land unconfirmed. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const content: string | undefined = body.content?.trim();
  if (!content) return Response.json({ error: "Empty memory." }, { status: 400 });

  const customerId = await resolveCustomerId(body.customerId);
  // Same human/agent-fixable-error bar as profiles/checklist/documents/import-monitor:
  // tell the caller exactly what to pass instead of a bare "No customer."
  if (!customerId) {
    return Response.json(
      { error: "No customer could be resolved. Pass a valid `customerId` in the JSON request body, or omit it to use the default customer if one exists." },
      { status: 404 }
    );
  }

  const kind = KINDS.includes(body.kind) ? body.kind : "other";
  const jurisdiction = normalizeJurisdiction(body.country);
  const memory = await addMemory({
    customerId,
    jurisdiction,
    kind,
    content,
    source: body.source ?? "entered by hand",
    origin: "manual",
    confirmed: true,
  });

  if (!memory) return Response.json({ error: "Already remembered." }, { status: 409 });
  await refreshChecklistForCustomer(customerId, jurisdiction);
  return Response.json({ memory });
}

/** PATCH — confirm or unconfirm a model-proposed memory. */
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (!body.id) return Response.json({ error: "No id." }, { status: 400 });
  await setMemoryConfirmed(body.id, Boolean(body.confirmed));
  const memory = await getMemory(body.id);
  if (memory) {
    await refreshChecklistForCustomer(
      memory.customerId,
      normalizeJurisdiction(memory.jurisdiction),
    );
  }
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "No id." }, { status: 400 });
  const memory = await getMemory(id);
  await deleteMemory(id);
  if (memory) {
    await refreshChecklistForCustomer(
      memory.customerId,
      normalizeJurisdiction(memory.jurisdiction),
    );
  }
  return Response.json({ ok: true });
}
