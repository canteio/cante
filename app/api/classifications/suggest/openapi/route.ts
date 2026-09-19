import { buildClassificationSuggestOpenApiSpec } from "@/lib/classification/suggest-openapi";

export const runtime = "nodejs";
// Discovery imports only storage-free contract code, so agents can inspect the
// endpoint before the operating database or model provider is configured.
export const dynamic = "force-static";

/** Machine-readable discovery for the classification suggestion review flow. */
export async function GET() {
  try {
    return Response.json(buildClassificationSuggestOpenApiSpec(), {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to build OpenAPI spec." },
      { status: 500 },
    );
  }
}
