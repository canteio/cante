import { DEFAULT_JURISDICTION, SUPPORTED_JURISDICTIONS } from "@/lib/countries";

const string = { type: "string" } as const;
const stringArray = { type: "array", items: string } as const;
const classificationCode = {
  type: "object",
  properties: {
    code: string,
    basis: { type: "string", default: "entered in profile" },
    confirmed: { type: "boolean", default: false },
  },
  required: ["code"],
} as const;
const codeArray = { type: "array", items: classificationCode } as const;
const error = { type: "object", properties: { error: {} }, required: ["error"] } as const;
const json = <T>(schema: T) => ({ "application/json": { schema } });

const profileInput = {
  type: "object",
  properties: {
    legalName: { type: ["string", "null"] },
    facilityAddresses: stringArray,
    naicsCodes: codeArray,
    products: stringArray,
    skus: stringArray,
    materialsChemicals: stringArray,
    manufacturingProcesses: stringArray,
    wasteStreams: stringArray,
    distributionStates: stringArray,
    labelsClaims: stringArray,
    htsScheduleBCodes: codeArray,
    exportClassifications: codeArray,
    exportCountries: stringArray,
    regulatedProductFlags: stringArray,
  },
} as const;

const storedProfile = {
  ...profileInput,
  properties: {
    id: string,
    customerId: string,
    country: { type: "string", enum: SUPPORTED_JURISDICTIONS.map(({ name }) => name) },
    ...profileInput.properties,
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: [
    "id", "customerId", "country", "legalName", "facilityAddresses", "naicsCodes",
    "products", "skus", "materialsChemicals", "manufacturingProcesses", "wasteStreams",
    "distributionStates", "labelsClaims", "htsScheduleBCodes", "exportClassifications",
    "exportCountries", "regulatedProductFlags", "createdAt", "updatedAt",
  ],
} as const;

const customerId = {
  type: "string",
  description: "Optional workspace selector. Supabase auth restricts this to the authenticated workspace; otherwise omission selects the default local customer.",
} as const;
const country = {
  type: "string",
  default: DEFAULT_JURISDICTION,
  description: "US/USA/ID aliases are accepted; missing or unrecognized values default to United States.",
} as const;

/** Build profile discovery without importing customer storage or checklist regeneration. */
export function buildProfilesOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Cante jurisdiction profile API",
      version: "1.0.0",
      description: "Read and replace the operating facts Cante uses to build a jurisdiction-specific compliance checklist.",
    },
    paths: {
      "/api/profiles": {
        get: {
          operationId: "getJurisdictionProfile",
          summary: "Read a workspace profile for one jurisdiction",
          parameters: [
            { name: "customerId", in: "query", required: false, schema: customerId },
            { name: "country", in: "query", required: false, schema: country },
          ],
          responses: {
            "200": { description: "The profile is null when no customer or saved jurisdiction profile exists.", content: json({ type: "object", properties: { country: { type: "string" }, profile: { oneOf: [{ type: "null" }, storedProfile] } }, required: ["profile"] }) },
            "500": { description: "Storage failed.", content: json(error) },
          },
        },
        put: {
          operationId: "putJurisdictionProfile",
          summary: "Replace a workspace profile and refresh its compliance checklist",
          requestBody: { required: true, content: json({ type: "object", properties: { customerId, country, profile: profileInput }, required: ["profile"] }) },
          responses: {
            "200": { description: "The normalized jurisdiction and stored profile.", content: json({ type: "object", properties: { country: { type: "string", enum: SUPPORTED_JURISDICTIONS.map(({ name }) => name) }, profile: storedProfile }, required: ["country", "profile"] }) },
            "400": { description: "The body is not an object or profile fields have invalid shapes. The response includes a corrective shape map.", content: json(error) },
            "404": { description: "No requested or default customer could be resolved.", content: json(error) },
            "500": { description: "Storage or checklist refresh failed.", content: json(error) },
          },
        },
      },
    },
  };
}
