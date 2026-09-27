import { buildChecklistOpenApiSpec } from "@/lib/checks/openapi";

export const runtime = "nodejs";
// Discovery contains no customer data and must not initialize a database.
export const dynamic = "force-static";

export async function GET() {
  return Response.json(buildChecklistOpenApiSpec(), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
