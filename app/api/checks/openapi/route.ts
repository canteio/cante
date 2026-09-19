import { buildChecksOpenApiSpec } from "@/lib/checks/runs-openapi";

export const runtime = "nodejs";
// Keep discovery usable when customer storage, an LLM CLI, or a regulation source is down.
export const dynamic = "force-static";

/** Machine-readable discovery for the GET and POST /api/checks contract. */
export async function GET() {
  return Response.json(buildChecksOpenApiSpec(), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
