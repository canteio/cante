import { buildTariffOpenApiSpec } from "@/lib/tariff/openapi";

export const runtime = "nodejs";
// Discovery is pure, so agents can inspect the contract while USITC or customer
// storage is unavailable.
export const dynamic = "force-static";

/** Machine-readable discovery for the complete /api/tariff GET contract. */
export async function GET() {
  try {
    return Response.json(buildTariffOpenApiSpec(), {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to build OpenAPI spec." },
      { status: 500 },
    );
  }
}
