import { buildImportMonitorOpenApiSpec } from "@/pipelines/import-manifest/monitor/openapi";

export const runtime = "nodejs";
// Static spec, safe to cache — unlike the monitor data route this carries no
// tenant data, so no auth/no-store is needed.
export const dynamic = "force-static";

/** Standard OpenAPI discovery endpoint for /api/import-monitor. Lets an AI
 * agent (or any OpenAPI-aware tool) fetch a machine-readable contract up
 * front instead of relying solely on the ad-hoc `params` field echoed on
 * that route's own responses. */
// Route-handler error audit continued (2026-09-19): every other route.ts in
// app/api already wraps its handler in try/catch (see the 2026-09-16 sweep
// noted on the sibling GET above and in query-route history) so a thrown
// error always comes back as parseable JSON, never Next's generic HTML error
// page — this was the one remaining handler in the repo without that guard.
// buildImportMonitorOpenApiSpec() is a pure function today, but this route is
// "force-static" and cached for an hour; if a future edit makes spec
// construction throw (e.g. a bad edit to monitorQueryDocs), an AI agent
// polling this discovery endpoint deserves the same {error} contract as
// every data route instead of an opaque 500 HTML page for the next hour.
export async function GET() {
  try {
    return Response.json(buildImportMonitorOpenApiSpec(), { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to build OpenAPI spec." },
      { status: 500 },
    );
  }
}
