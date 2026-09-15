import { z } from "zod";
import {
  getJurisdictionProfile,
  resolveCustomerId,
  upsertJurisdictionProfile,
} from "@/lib/db/queries";
import { refreshChecklistForCustomer } from "@/lib/checks/checklist";
import { normalizeJurisdiction } from "@/lib/countries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CodeSchema = z.object({
  code: z.string().trim().min(1),
  basis: z.string().trim().default("entered in profile"),
  confirmed: z.boolean().default(false),
});

const ProfileSchema = z.object({
  legalName: z.string().trim().nullable().optional(),
  facilityAddresses: z.array(z.string().trim()).optional(),
  naicsCodes: z.array(CodeSchema).optional(),
  products: z.array(z.string().trim()).optional(),
  skus: z.array(z.string().trim()).optional(),
  materialsChemicals: z.array(z.string().trim()).optional(),
  manufacturingProcesses: z.array(z.string().trim()).optional(),
  wasteStreams: z.array(z.string().trim()).optional(),
  distributionStates: z.array(z.string().trim()).optional(),
  labelsClaims: z.array(z.string().trim()).optional(),
  htsScheduleBCodes: z.array(CodeSchema).optional(),
  exportClassifications: z.array(CodeSchema).optional(),
  exportCountries: z.array(z.string().trim()).optional(),
  regulatedProductFlags: z.array(z.string().trim()).optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const customerId = await resolveCustomerId(url.searchParams.get("customerId"));
  if (!customerId) return Response.json({ profile: null });
  const country = normalizeJurisdiction(url.searchParams.get("country"));
  return Response.json({ country, profile: await getJurisdictionProfile(customerId, country) });
}

// Machine-readable shape doc, same "self-correct from the response body
// alone" posture as pipelines/import-manifest/monitor/query.ts's
// monitorQueryDocs — an agent that PUTs a malformed profile body gets the
// expected field shapes right in the 400 payload instead of having to
// cross-reference this source file.
const profileShapeDocs = {
  legalName: { type: "string | null", optional: true },
  facilityAddresses: { type: "string[]", optional: true },
  naicsCodes: { type: "{ code: string, basis?: string, confirmed?: boolean }[]", optional: true },
  products: { type: "string[]", optional: true },
  skus: { type: "string[]", optional: true },
  materialsChemicals: { type: "string[]", optional: true },
  manufacturingProcesses: { type: "string[]", optional: true },
  wasteStreams: { type: "string[]", optional: true },
  distributionStates: { type: "string[]", optional: true },
  labelsClaims: { type: "string[]", optional: true },
  htsScheduleBCodes: { type: "{ code: string, basis?: string, confirmed?: boolean }[]", optional: true },
  exportClassifications: { type: "{ code: string, basis?: string, confirmed?: boolean }[]", optional: true },
  exportCountries: { type: "string[]", optional: true },
  regulatedProductFlags: { type: "string[]", optional: true },
} as const;

export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({}));
  const customerId = await resolveCustomerId(body.customerId);
  // "No customer." gave a caller nothing to act on; spell out the fix inline
  // (same human/agent-fixable-error bar as the import-monitor query params)
  // rather than making the caller go read resolveCustomerId's source.
  if (!customerId) {
    return Response.json(
      { error: "No customer could be resolved. Pass a valid `customerId` in the request body, or omit it to use the default customer if one exists." },
      { status: 404 },
    );
  }
  const country = normalizeJurisdiction(body.country);
  const parsed = ProfileSchema.safeParse(body.profile);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten(), shape: profileShapeDocs }, { status: 400 });
  }
  const profile = await upsertJurisdictionProfile(customerId, country, parsed.data);
  await refreshChecklistForCustomer(customerId, country);
  return Response.json({ country, profile });
}
