import { z } from "zod";

export const ProfileCodeSchema = z.object({
  code: z.string().trim().min(1),
  basis: z.string().trim().default("entered in profile"),
  confirmed: z.boolean().default(false),
});

export const JurisdictionProfileInputSchema = z.object({
  legalName: z.string().trim().nullable().optional(),
  facilityAddresses: z.array(z.string().trim()).optional(),
  naicsCodes: z.array(ProfileCodeSchema).optional(),
  products: z.array(z.string().trim()).optional(),
  skus: z.array(z.string().trim()).optional(),
  materialsChemicals: z.array(z.string().trim()).optional(),
  manufacturingProcesses: z.array(z.string().trim()).optional(),
  wasteStreams: z.array(z.string().trim()).optional(),
  distributionStates: z.array(z.string().trim()).optional(),
  labelsClaims: z.array(z.string().trim()).optional(),
  htsScheduleBCodes: z.array(ProfileCodeSchema).optional(),
  exportClassifications: z.array(ProfileCodeSchema).optional(),
  exportCountries: z.array(z.string().trim()).optional(),
  regulatedProductFlags: z.array(z.string().trim()).optional(),
});

// Keep corrective 400 responses machine-readable without making callers inspect Zod internals.
export const profileShapeDocs = {
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
