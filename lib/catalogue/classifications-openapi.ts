import {
  CLASSIFICATION_PATCH_ACTIONS,
  CLASSIFICATION_STATUSES,
  CLASSIFICATION_TIERS,
  DIRECT_CLASSIFICATION_TIERS,
} from "./classifications-contract";

const nullableString = { type: ["string", "null"] } as const;
const errorSchema = {
  type: "object",
  properties: { error: { type: "string" } },
  required: ["error"],
} as const;

const classificationSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    productId: { type: "string" },
    system: { type: "string", description: "Classification system, for example HTS or HS." },
    jurisdiction: nullableString,
    code: { type: "string" },
    tier: { type: "string", enum: CLASSIFICATION_TIERS },
    basis: { type: "string" },
    supportingRefs: { type: "array", items: { type: "object", additionalProperties: true } },
    rationale: nullableString,
    status: { type: "string", enum: CLASSIFICATION_STATUSES },
    approvedBy: nullableString,
    approvedAt: { type: ["string", "null"], format: "date-time" },
    supersededAt: { type: ["string", "null"], format: "date-time" },
    supersededBy: nullableString,
    createdAt: { type: "string", format: "date-time" },
  },
  required: ["id", "productId", "system", "code", "tier", "basis", "status", "createdAt"],
} as const;

const resolvedSchema = {
  type: "object",
  properties: {
    current: { oneOf: [classificationSchema, { type: "null" }] },
    approved: { type: "array", items: classificationSchema },
    document: { type: "array", items: classificationSchema },
    human: { type: "array", items: classificationSchema },
    leads: { type: "array", items: classificationSchema },
    guesses: { type: "array", items: classificationSchema },
    documentVerified: { type: "boolean" },
  },
  required: ["current", "approved", "document", "human", "leads", "guesses", "documentVerified"],
} as const;

const proposalInput = {
  type: "object",
  properties: {
    productId: { type: "string" },
    system: { type: "string" },
    code: { type: "string" },
    tier: {
      type: "string",
      enum: DIRECT_CLASSIFICATION_TIERS,
      description: "document is intentionally excluded. Create document-tier evidence through /api/documents.",
    },
    basis: { type: "string" },
    jurisdiction: nullableString,
    rationale: nullableString,
  },
  required: ["productId", "system", "code", "tier", "basis"],
} as const;

const approveInput = {
  type: "object",
  properties: {
    action: { type: "string", enum: [CLASSIFICATION_PATCH_ACTIONS[0]], default: "approve" },
    classificationId: { type: "string" },
    approvedBy: { type: "string" },
    rationale: { type: "string" },
  },
  required: ["classificationId", "approvedBy", "rationale"],
} as const;

const rejectInput = {
  type: "object",
  properties: {
    action: { type: "string", enum: [CLASSIFICATION_PATCH_ACTIONS[1]] },
    classificationId: { type: "string" },
    reason: { type: "string" },
  },
  required: ["action", "classificationId", "reason"],
} as const;

/** Build a storage-independent contract for the classification decision flow. */
export function buildClassificationsOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Cante Classifications API",
      version: "1.0.0",
      description:
        "Propose, inspect, approve, or reject product tariff classifications. Proposals never become approved in the same call, and lead/guess tiers cannot be approved.",
    },
    paths: {
      "/api/classifications": {
        get: {
          summary: "List a product's full classification history and optionally resolve one system and jurisdiction.",
          parameters: [
            { name: "productId", in: "query", required: true, schema: { type: "string" } },
            { name: "system", in: "query", required: false, schema: { type: "string" }, description: "When present, the response also includes resolved." },
            { name: "jurisdiction", in: "query", required: false, schema: { type: "string" }, description: "Used with system; omission resolves the null jurisdiction." },
          ],
          responses: {
            "200": {
              description: "Classification history, plus resolved when system is supplied.",
              content: { "application/json": { schema: {
                type: "object",
                properties: {
                  history: { type: "array", items: classificationSchema },
                  resolved: resolvedSchema,
                },
                required: ["history"],
              } } },
            },
            "400": { description: "productId is missing.", content: { "application/json": { schema: errorSchema } } },
          },
        },
        post: {
          summary: "Record an unapproved classification proposal.",
          description: "The result always has status proposed. Direct document-tier assertions are rejected.",
          requestBody: { required: true, content: { "application/json": { schema: proposalInput } } },
          responses: {
            "200": { description: "The new or existing idempotent proposal.", content: { "application/json": { schema: { type: "object", properties: { classification: classificationSchema }, required: ["classification"] } } } },
            "400": { description: "Malformed JSON, missing fields, invalid tier, or a direct document-tier assertion.", content: { "application/json": { schema: errorSchema } } },
          },
        },
        patch: {
          summary: "Approve or reject a classification in a separate human decision.",
          description: "Omitting action selects approve for backward compatibility. Approval requires a human/document tier, a named approver, and rationale. Rejection requires action=reject and a reason.",
          requestBody: { required: true, content: { "application/json": { schema: { oneOf: [approveInput, rejectInput] } } } },
          responses: {
            "200": {
              description: "Approval returns { classification }; rejection returns { ok: true }.",
              content: { "application/json": { schema: { oneOf: [
                { type: "object", properties: { classification: classificationSchema }, required: ["classification"] },
                { type: "object", properties: { ok: { type: "boolean", const: true } }, required: ["ok"] },
              ] } } },
            },
            "400": { description: "Malformed JSON, missing decision fields, an unknown/superseded classification, or a tier that cannot be approved.", content: { "application/json": { schema: errorSchema } } },
            "500": { description: "The classification could not be updated.", content: { "application/json": { schema: errorSchema } } },
          },
        },
      },
    },
  };
}
