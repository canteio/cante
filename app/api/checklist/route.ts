import {
  listChecklistItems,
  resolveCustomerId,
  updateChecklistItemStatus,
} from "@/lib/db/queries";
import { refreshChecklistForCustomer } from "@/lib/checks/checklist";
import { normalizeJurisdiction } from "@/lib/countries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  if (!customerId) return Response.json({ error: "No customer." }, { status: 404 });
  const jurisdiction = normalizeJurisdiction(body.country);

  await refreshChecklistForCustomer(customerId, jurisdiction);
  return Response.json({ items: await listChecklistItems(customerId, jurisdiction), jurisdiction });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (!body.id || !body.status) return Response.json({ error: "Missing id or status." }, { status: 400 });
  await updateChecklistItemStatus(body.id, String(body.status));
  return Response.json({ ok: true });
}
