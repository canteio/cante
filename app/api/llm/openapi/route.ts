import { buildLlmOpenApiSpec } from "@/lib/llm/openapi";

export const runtime = "nodejs";
// Discovery must stay usable when storage or local model executables are unavailable.
export const dynamic = "force-static";

/** Machine-readable discovery for the provider-selection API. */
export async function GET() {
  return Response.json(buildLlmOpenApiSpec(), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
