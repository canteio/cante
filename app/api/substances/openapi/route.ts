import { buildSubstancesOpenApiSpec } from "@/lib/substances/openapi";

export const runtime = "nodejs";
// The contract imports no storage modules, so discovery stays available even
// when a deployment has not configured its customer database yet.
export const dynamic = "force-static";

/** Machine-readable discovery for every /api/substances operation. */
export async function GET() {
  try {
    return Response.json(buildSubstancesOpenApiSpec(), {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to build OpenAPI spec." },
      { status: 500 },
    );
  }
}
