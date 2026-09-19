import { buildFilesExtractOpenApiSpec } from "@/lib/documents/files-extract-openapi";

export const runtime = "nodejs";
// Discovery must work even when customer storage and document parsers are unavailable.
export const dynamic = "force-static";

/** Machine-readable discovery for POST /api/files/extract. */
export async function GET() {
  return Response.json(buildFilesExtractOpenApiSpec(), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
