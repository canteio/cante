import { buildLanesOpenApiSpec } from "@/lib/catalogue/lanes-openapi";

export const runtime = "nodejs";
// Discovery contains no tenant data and deliberately imports no storage code.
export const dynamic = "force-static";

/** Machine-readable discovery for agents integrating with /api/lanes. */
export async function GET() {
  try {
    return Response.json(buildLanesOpenApiSpec(), {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch (error) {
    // Keep even construction failures machine-readable for unattended clients.
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to build OpenAPI spec." },
      { status: 500 },
    );
  }
}
