import { buildProfilesOpenApiSpec } from "@/lib/profiles/openapi";

export const runtime = "nodejs";
// Profile discovery must remain available while customer storage is unavailable.
export const dynamic = "force-static";

/** Machine-readable discovery for /api/profiles. */
export async function GET() {
  return Response.json(buildProfilesOpenApiSpec(), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
