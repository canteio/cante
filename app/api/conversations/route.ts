import {
  deleteConversation,
  getConversation,
  listConversations,
  resolveCustomerId,
} from "@/lib/db/queries";
import { normalizeJurisdiction } from "@/lib/countries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/conversations            — list for the sidebar
 *  GET /api/conversations?id=<id>    — one conversation with its messages */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  // Route-handler error audit (2026-09-16, continuing the customers/route.ts
  // and import-monitor/route.ts sweep): this GET had zero try/catch, so a DB
  // failure in getConversation/resolveCustomerId/listConversations fell
  // through to Next's generic HTML error page instead of a parseable JSON
  // {error} body — breaks any AI-agent client expecting JSON on every status.
  try {
    if (id) {
      const found = await getConversation(id);
      // Same "self-correct from the response body alone" bar as
      // checklist/profiles/import-monitor: spell out what to do next instead
      // of a bare "Not found." — the id is likely stale or from another customer.
      if (!found) {
        return Response.json(
          { error: `No conversation matches id "${id}". It may have been deleted, or belong to a different customer — call GET /api/conversations?customerId=<id> to list current ones.` },
          { status: 404 },
        );
      }
      return Response.json(found);
    }

    const customerId = await resolveCustomerId(url.searchParams.get("customerId"));
    if (!customerId) return Response.json({ conversations: [] });
    const jurisdiction = normalizeJurisdiction(url.searchParams.get("country"));
    return Response.json({
      jurisdiction,
      conversations: await listConversations(customerId, jurisdiction),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load conversations." },
      { status: 500 },
    );
  }
}

/** DELETE /api/conversations?id=<id> */
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  // Bare "No id." forced a caller to guess the param name; name it explicitly.
  if (!id) {
    return Response.json(
      { error: "Missing `id` query parameter. Call as DELETE /api/conversations?id=<conversation id>." },
      { status: 400 },
    );
  }
  // Route-handler error audit (2026-09-17, continuing the GET/profiles/lanes
  // sweep): this DELETE had zero try/catch, so a DB failure in
  // deleteConversation fell through to Next's generic HTML error page
  // instead of a parseable JSON {error} body — breaks any AI-agent client
  // that expects JSON on every status, not just the happy path.
  try {
    await deleteConversation(id);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to delete conversation." },
      { status: 500 },
    );
  }
}
