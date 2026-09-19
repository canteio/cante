import { buildDocumentsOpenApiSpec } from "@/lib/documents/openapi";

export const runtime = "nodejs";
// Discovery must remain available when customer storage or document processing is down.
export const dynamic = "force-static";

/** Machine-readable discovery for the GET and POST /api/documents contract. */
export async function GET() {
  return Response.json(buildDocumentsOpenApiSpec(), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
