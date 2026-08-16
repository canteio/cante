import { z } from "zod";
import {
  getDefaultCustomerId,
  getJurisdictionProfile,
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
  const customerId = url.searchParams.get("customerId") ?? (await getDefaultCustomerId());
  if (!customerId) return Response.json({ profile: null });
  const country = normalizeJurisdiction(url.searchParams.get("country"));
  return Response.json({ country, profile: await getJurisdictionProfile(customerId, country) });
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({}));
  const customerId: string | null = body.customerId ?? (await getDefaultCustomerId());
  if (!customerId) return Response.json({ error: "No customer." }, { status: 404 });
  const country = normalizeJurisdiction(body.country);
  const parsed = ProfileSchema.safeParse(body.profile);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const profile = await upsertJurisdictionProfile(customerId, country, parsed.data);
  await refreshChecklistForCustomer(customerId, country);
  return Response.json({ country, profile });
}
