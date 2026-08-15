import {
  deleteConversation,
  getConversation,
  getDefaultCustomerId,
  listConversations,
} from "@/lib/db/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/conversations            — list for the sidebar
 *  GET /api/conversations?id=<id>    — one conversation with its messages */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (id) {
    const found = await getConversation(id);
    if (!found) return Response.json({ error: "Not found." }, { status: 404 });
    return Response.json(found);
  }

  const customerId = url.searchParams.get("customerId") ?? (await getDefaultCustomerId());
  if (!customerId) return Response.json({ conversations: [] });
  return Response.json({ conversations: await listConversations(customerId) });
}

/** DELETE /api/conversations?id=<id> */
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "No id." }, { status: 400 });
  await deleteConversation(id);
  return Response.json({ ok: true });
}
