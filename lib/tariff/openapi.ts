const nullableString = { type: ["string", "null"] } as const;
const nullableNumber = { type: ["number", "null"] } as const;
const errorSchema = {
  type: "object",
  properties: { error: { type: "string" } },
  required: ["error"],
} as const;

const dutyRateSchema = {
  type: "object",
  properties: {
    raw: { type: "string" },
    adValorem: nullableNumber,
    specificAmount: nullableNumber,
    specificUnit: nullableString,
    free: { type: "boolean" },
    parsed: { type: "boolean" },
    note: { type: "string" },
  },
  required: ["raw", "adValorem", "specificAmount", "specificUnit", "free", "parsed"],
} as const;

const tariffRowSchema = {
  type: "object",
  properties: {
    htsCode: { type: "string" },
    description: { type: "string" },
    units: { type: "array", items: { type: "string" } },
    general: dutyRateSchema,
    special: dutyRateSchema,
    specialProgrammes: { type: "array", items: { type: "string" } },
    column2: dutyRateSchema,
    additionalDuties: nullableString,
    fetchedAt: { type: "string", format: "date-time" },
  },
  required: ["htsCode", "description", "units", "general", "special", "specialProgrammes", "column2", "additionalDuties", "fetchedAt"],
} as const;

const dutyQuoteSchema = {
  type: "object",
  properties: {
    htsCode: { type: "string" },
    column: { type: "string", enum: ["general", "special", "column2"] },
    rate: dutyRateSchema,
    computation: {
      type: "object",
      properties: {
        amount: nullableNumber,
        currency: { type: "string", enum: ["USD"] },
        basis: { type: "array", items: { type: "string" } },
      },
      required: ["amount", "currency", "basis"],
    },
    additionalDutiesNote: nullableString,
    caveats: { type: "array", items: { type: "string" } },
  },
  required: ["htsCode", "column", "rate", "computation", "additionalDutiesNote", "caveats"],
} as const;

/** Build tariff discovery without importing the live USITC lookup client. */
export function buildTariffOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Cante US Tariff API",
      version: "1.0.0",
      description: "Look up official USITC HTS rows, quote US import duty, or compare declared and expected classifications. Quotes exclude unresolved Chapter 99 duties.",
    },
    paths: {
      "/api/tariff": {
        get: {
          summary: "Look up an HTS row, quote shipment duty, or compare two classifications.",
          description: "Provide code for a row lookup. Add value to receive a quote. Alternatively provide both declared and expected for a comparison. This endpoint covers US import duty only.",
          parameters: [
            { name: "code", in: "query", required: false, schema: { type: "string" }, description: "HTS code for a row lookup or quote." },
            { name: "declared", in: "query", required: false, schema: { type: "string" }, description: "Declared HTS code. Use with expected." },
            { name: "expected", in: "query", required: false, schema: { type: "string" }, description: "Expected HTS code. Use with declared." },
            { name: "value", in: "query", required: false, schema: { type: "number" }, description: "Shipment customs value in USD. With code, selects the quote response." },
            { name: "quantity", in: "query", required: false, schema: { type: "number" }, description: "Quantity required by specific or compound rates." },
            { name: "unit", in: "query", required: false, schema: { type: "string" }, description: "Quantity unit exactly as published by the HTS row, such as kg." },
            { name: "programme", in: "query", required: false, schema: { type: "string" }, description: "Claimed special-programme symbol. Eligibility remains unverified." },
          ],
          responses: {
            "200": {
              description: "A published row, duty quote, or declared-versus-expected comparison.",
              content: { "application/json": { schema: { oneOf: [
                { type: "object", properties: { row: tariffRowSchema }, required: ["row"] },
                { type: "object", properties: { quote: dutyQuoteSchema }, required: ["quote"] },
                {
                  type: "object",
                  properties: {
                    declared: { oneOf: [dutyQuoteSchema, { type: "null" }] },
                    expected: { oneOf: [dutyQuoteSchema, { type: "null" }] },
                    difference: nullableNumber,
                    currency: { type: "string", enum: ["USD"] },
                    basis: { type: "array", items: { type: "string" } },
                  },
                  required: ["declared", "expected", "difference", "currency", "basis"],
                },
              ] } } },
            },
            "400": { description: "The request lacks a usable operation or value is not numeric.", content: { "application/json": { schema: errorSchema } } },
            "404": { description: "No published HTS row matched code.", content: { "application/json": { schema: errorSchema } } },
            "500": { description: "An unexpected tariff lookup failure.", content: { "application/json": { schema: errorSchema } } },
            "502": { description: "The code is unusable or the upstream USITC service failed or returned an invalid payload.", content: { "application/json": { schema: errorSchema } } },
          },
        },
      },
    },
  };
}
