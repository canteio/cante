import { buildScreeningOpenApiSpec } from "@/lib/screening/openapi";

export const runtime = "nodejs";
// The discovery document contains no tenant data or storage imports.
export const dynamic = "force-static";

/** Machine-readable discovery for agents integrating with /api/screening. */
export async function GET() {
  try {
    return Response.json(buildScreeningOpenApiSpec(), {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to build OpenAPI spec." },
      { status: 500 },
    );
  }
}
