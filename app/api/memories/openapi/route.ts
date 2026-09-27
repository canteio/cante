import { buildMemoriesOpenApiSpec } from "@/lib/memories/openapi";

export const runtime = "nodejs";
// Agents should still discover the contract while customer storage is unavailable.
export const dynamic = "force-static";

/** Machine-readable discovery for /api/memories. */
export async function GET() {
  return Response.json(buildMemoriesOpenApiSpec(), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
