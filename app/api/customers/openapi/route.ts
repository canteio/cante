import { buildCustomersOpenApiSpec } from "@/lib/customers/openapi";

export const runtime = "nodejs";
// Agents must be able to discover this contract while customer storage or a model CLI is down.
export const dynamic = "force-static";

/** Machine-readable discovery for /api/customers. */
export async function GET() {
  return Response.json(buildCustomersOpenApiSpec(), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
