import { buildImportMonitorOpenApiSpec } from "@/pipelines/import-manifest/monitor/openapi";

export const runtime = "nodejs";
// Static spec, safe to cache — unlike the monitor data route this carries no
// tenant data, so no auth/no-store is needed.
export const dynamic = "force-static";

/** Standard OpenAPI discovery endpoint for /api/import-monitor. Lets an AI
 * agent (or any OpenAPI-aware tool) fetch a machine-readable contract up
 * front instead of relying solely on the ad-hoc `params` field echoed on
 * that route's own responses. */
export async function GET() {
  return Response.json(buildImportMonitorOpenApiSpec(), { headers: { "Cache-Control": "public, max-age=3600" } });
}
