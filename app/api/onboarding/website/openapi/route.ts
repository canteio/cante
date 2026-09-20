import { buildOnboardingWebsiteOpenApiSpec } from "@/lib/documents/onboarding-website-openapi";

export const runtime = "nodejs";
// Discovery stays available when storage, networking, or model executables are unavailable.
export const dynamic = "force-static";

/** Machine-readable discovery for website-assisted onboarding. */
export async function GET() {
  return Response.json(buildOnboardingWebsiteOpenApiSpec(), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
