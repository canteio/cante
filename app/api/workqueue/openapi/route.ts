import { buildWorkQueueOpenApiSpec } from "@/lib/workflow/openapi";

export const runtime = "nodejs";
// Static spec, safe to cache — no tenant data, mirrors
// app/api/import-monitor/openapi/route.ts's caching + error-handling pattern
// exactly (same discoverability gap, same fix).
export const dynamic = "force-static";

/** Standard OpenAPI discovery endpoint for /api/workqueue. Lets an AI agent
 * (or any OpenAPI-aware tool) fetch a machine-readable contract for the
 * action-workflow + impact + draft join instead of reverse-engineering it
 * from source or trial-and-error requests. */
export async function GET() {
  try {
    return Response.json(buildWorkQueueOpenApiSpec(), { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to build OpenAPI spec." },
      { status: 500 },
    );
  }
}
