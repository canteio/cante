import { buildSuppliersOpenApiSpec } from "@/lib/suppliers/openapi";

export const runtime = "nodejs";
// Static spec, safe to cache — no tenant data, same caching + error-handling
// pattern as app/api/workqueue/openapi/route.ts and
// app/api/import-monitor/openapi/route.ts.
export const dynamic = "force-static";

/** Standard OpenAPI discovery endpoint for /api/suppliers. Lets an AI agent
 * (or any OpenAPI-aware tool) fetch a machine-readable contract for the
 * supplier + evidence + screening join instead of reverse-engineering it
 * from source or trial-and-error requests. */
export async function GET() {
  try {
    return Response.json(buildSuppliersOpenApiSpec(), { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to build OpenAPI spec." },
      { status: 500 },
    );
  }
}
