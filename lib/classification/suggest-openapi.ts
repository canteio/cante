import { SUGGESTION_CONFIDENCE_LEVELS } from "./suggest-contract";

const nullableString = { type: ["string", "null"] } as const;
const errorSchema = {
  type: "object",
  properties: { error: { type: "string" } },
  required: ["error"],
} as const;

const pendingSuggestionSchema = {
  type: "object",
  properties: {
    productSku: { type: "string" },
    classificationId: { type: "string" },
    code: { type: "string" },
    system: { type: "string" },
    basis: { type: "string" },
    rationale: nullableString,
  },
  required: ["productSku", "classificationId", "code", "system", "basis", "rationale"],
} as const;

const suggestionSchema = {
  type: "object",
  properties: {
    noSuitableCandidate: { type: "boolean" },
    recommendedCode: { type: "string" },
    confidence: { type: "string", enum: SUGGESTION_CONFIDENCE_LEVELS },
    griApplied: { type: "string" },
    rationale: { type: "string" },
    alternatives: {
      type: "array",
      items: {
        type: "object",
        properties: { code: { type: "string" }, whyNotChosen: { type: "string" } },
        required: ["code", "whyNotChosen"],
      },
    },
    uncertainties: { type: "array", items: { type: "string" } },
    needsExpertReview: { type: "boolean" },
  },
  required: [
    "noSuitableCandidate",
    "recommendedCode",
    "confidence",
    "griApplied",
    "rationale",
    "alternatives",
    "uncertainties",
    "needsExpertReview",
  ],
} as const;

const classificationSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    id: { type: "string" },
    productId: { type: "string" },
    system: { type: "string" },
    code: { type: "string" },
    tier: { type: "string", enum: ["lead", "human"] },
    basis: { type: "string" },
  },
  required: ["id", "productId", "system", "code", "tier", "basis"],
} as const;

/** Build discovery without importing the database, model provider, or Next cookies. */
export function buildClassificationSuggestOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Cante Classification Suggestions API",
      version: "1.0.0",
      description:
        "Generate model-assisted HTS leads from official candidate rows, list pending leads, and record a separate human adoption. This API never approves a classification.",
    },
    paths: {
      "/api/classifications/suggest": {
        get: {
          summary: "List unadopted model suggestions awaiting human review.",
          parameters: [
            {
              name: "customerId",
              in: "query",
              required: false,
              schema: { type: "string" },
              description: "Defaults to the active customer. No resolved customer returns an empty list.",
            },
          ],
          responses: {
            "200": {
              description: "Pending model-generated lead-tier classifications.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { pending: { type: "array", items: pendingSuggestionSchema } },
                    required: ["pending"],
                  },
                },
              },
            },
          },
        },
        post: {
          summary: "Generate an HTS suggestion and optionally store it as an unconfirmed lead.",
          description:
            "The model may only choose an official candidate row. Supplying productId stores the suggestion at lead tier; omitting it returns classification as null. The response is not a customs ruling or approval.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    sku: { type: "string" },
                    customerId: { type: "string" },
                    productId: { type: "string" },
                  },
                  required: ["sku"],
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "200": {
              description: "A guarded model suggestion plus evidence and optional stored lead.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      suggestion: suggestionSchema,
                      candidateCount: { type: "integer", minimum: 1 },
                      rulings: { type: "array", items: { type: "object", additionalProperties: true } },
                      chosenRow: { oneOf: [{ type: "object", additionalProperties: true }, { type: "null" }] },
                      caveats: { type: "array", items: { type: "string" } },
                      classification: { oneOf: [classificationSchema, { type: "null" }] },
                    },
                    required: ["suggestion", "candidateCount", "rulings", "chosenRow", "caveats", "classification"],
                  },
                },
              },
            },
            "400": {
              description: "Invalid JSON/object input, missing SKU, missing product, no usable official candidates, or an unsafe model answer.",
              content: { "application/json": { schema: errorSchema } },
            },
            "500": { description: "The provider or suggestion flow failed.", content: { "application/json": { schema: errorSchema } } },
          },
        },
        patch: {
          summary: "Adopt a lead-tier model suggestion as a human classification proposal.",
          description:
            "Adoption requires a named person and written reason. It changes lead to human but does not approve the classification.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    classificationId: { type: "string" },
                    adoptedBy: { type: "string" },
                    reason: { type: "string" },
                  },
                  required: ["classificationId", "adoptedBy", "reason"],
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "200": {
              description: "The adopted human-tier classification proposal.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { classification: classificationSchema },
                    required: ["classification"],
                  },
                },
              },
            },
            "400": {
              description: "Invalid JSON/object input, unknown classification, wrong tier, or missing adoption details.",
              content: { "application/json": { schema: errorSchema } },
            },
            "500": { description: "The suggestion could not be adopted.", content: { "application/json": { schema: errorSchema } } },
          },
        },
      },
    },
  };
}
