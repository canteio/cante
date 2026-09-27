import { buildClassificationsOpenApiSpec } from "@/lib/catalogue/classifications-openapi";

export const runtime = "nodejs";
// The builder imports only storage-free contracts, so discovery still works
// while an operator is configuring or repairing the customer database.
export const dynamic = "force-static";

/** Machine-readable discovery for every /api/classifications operation. */
export async function GET() {
  try {
    return Response.json(buildClassificationsOpenApiSpec(), {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to build OpenAPI spec." },
      { status: 500 },
    );
  }
}
