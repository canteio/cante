import { buildConversationsOpenApiSpec } from "@/lib/conversations/openapi";

export const runtime = "nodejs";
// Discovery must remain available when conversation storage or auth is down.
export const dynamic = "force-static";

/** Machine-readable discovery for GET and DELETE /api/conversations. */
export async function GET() {
  return Response.json(buildConversationsOpenApiSpec(), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
