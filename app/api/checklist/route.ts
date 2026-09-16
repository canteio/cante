import {
  listChecklistItems,
  resolveCustomerId,
  updateChecklistItemStatus,
} from "@/lib/db/queries";
import { refreshChecklistForCustomer } from "@/lib/checks/checklist";
import { normalizeJurisdiction } from "@/lib/countries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Same "self-correct from the response body alone" posture as
// app/api/profiles/route.ts's profileShapeDocs and
// pipelines/import-manifest/monitor/query.ts's monitorQueryDocs: an agent
// hitting a 400/404 here gets the expected shape inline instead of having
// to go read this source file.
const checklistPatchShapeDocs = {
  id: { type: "string", required: true, description: "Checklist item id, from a prior GET /api/checklist response." },
  status: { type: "string", required: true, description: "New status value, e.g. \"done\", \"pending\", \"skipped\"." },
} as const;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const customerId = await resolveCustomerId(url.searchParams.get("customerId"));
  const jurisdiction = normalizeJurisdiction(url.searchParams.get("country"));
  if (!customerId) return Response.json({ items: [] });

  let items = await listChecklistItems(customerId, jurisdiction);
  if (items.length === 0) {
    await refreshChecklistForCustomer(customerId, jurisdiction);
    items = await listChecklistItems(customerId, jurisdiction);
  }
  return Response.json({ items, jurisdiction });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const customerId = await resolveCustomerId(body.customerId);
  // Spell out the fix inline (same bar as profiles PUT and import-monitor's
  // query params) instead of a bare "No customer." a caller can't act on.
  if (!customerId) {
    return Response.json(
      { error: "No customer could be resolved. Pass a valid `customerId` in the request body, or omit it to use the default customer if one exists." },
      { status: 404 },
    );
  }
  const jurisdiction = normalizeJurisdiction(body.country);

  await refreshChecklistForCustomer(customerId, jurisdiction);
  return Response.json({ items: await listChecklistItems(customerId, jurisdiction), jurisdiction });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (!body.id || !body.status) {
    // Echo the shape doc so an agent can self-correct from this response
    // alone rather than needing the source file.
    return Response.json({ error: "Missing `id` and/or `status`.", shape: checklistPatchShapeDocs }, { status: 400 });
  }
  // Route-handler error audit (2026-09-17, continuing the GET/profiles/lanes/
  // conversations sweep): this PATCH had zero try/catch, so a DB failure in
  // updateChecklistItemStatus fell through to Next's generic HTML error page
  // instead of a parseable JSON {error} body — same AI-agent-API-cleanliness
  // fix applied everywhere else in this sweep.
  try {
    await updateChecklistItemStatus(body.id, String(body.status));
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to update checklist item." },
      { status: 500 },
    );
  }
}
