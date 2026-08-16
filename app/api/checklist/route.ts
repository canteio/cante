import {
  getDefaultCustomerId,
  listChecklistItems,
  updateChecklistItemStatus,
} from "@/lib/db/queries";
import { refreshChecklistForCustomer } from "@/lib/checks/checklist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId") ?? (await getDefaultCustomerId());
  if (!customerId) return Response.json({ items: [] });

  let items = await listChecklistItems(customerId);
  if (items.length === 0) {
    await refreshChecklistForCustomer(customerId);
    items = await listChecklistItems(customerId);
  }
  return Response.json({ items });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const customerId: string | null = body.customerId ?? (await getDefaultCustomerId());
  if (!customerId) return Response.json({ error: "No customer." }, { status: 404 });

  await refreshChecklistForCustomer(customerId);
  return Response.json({ items: await listChecklistItems(customerId) });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (!body.id || !body.status) return Response.json({ error: "Missing id or status." }, { status: 400 });
  await updateChecklistItemStatus(body.id, String(body.status));
  return Response.json({ ok: true });
}
