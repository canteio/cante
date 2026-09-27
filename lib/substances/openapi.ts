import { RESTRICTION_VERDICTS, SUBSTANCES_ACTIONS } from "./contract";

/**
 * Pure OpenAPI contract for the substances route. This module must not import
 * bom.ts or db/client.ts: discovery should work before storage is configured.
 */
const nullableString = { type: "string", nullable: true } as const;
const nullableNumber = { type: "number", nullable: true } as const;
const errorSchema = {
  type: "object",
  properties: { error: { type: "string" }, validActions: { type: "array", items: { type: "string", enum: SUBSTANCES_ACTIONS } } },
  required: ["error"],
} as const;

const componentSchema = {
  type: "object",
  properties: {
    id: { type: "string" }, productId: { type: "string" }, parentComponentId: nullableString,
    name: { type: "string" }, partNumber: nullableString, supplierId: nullableString,
    quantity: nullableNumber, unit: nullableString, massGrams: nullableNumber,
    notes: nullableString, createdAt: { type: "string", format: "date-time" },
    children: { type: "array", items: { $ref: "#/components/schemas/ComponentNode" } },
  },
  required: ["id", "productId", "name", "createdAt"],
} as const;

const assessmentSchema = {
  type: "object",
  properties: {
    hits: {
      type: "array",
      items: {
        type: "object",
        properties: {
          productSku: { type: "string" }, componentName: { type: "string" }, substanceName: { type: "string" },
          casNumber: nullableString, listName: { type: "string" }, jurisdiction: { type: "string" },
          restriction: { type: "string" }, thresholdPpm: nullableNumber, declaredPpm: nullableNumber,
          verdict: { type: "string", enum: RESTRICTION_VERDICTS }, tier: { type: "string" }, detail: { type: "string" },
        },
        required: ["productSku", "componentName", "substanceName", "listName", "jurisdiction", "restriction", "verdict", "tier", "detail"],
      },
    },
    undeclaredComponents: {
      type: "array",
      items: { type: "object", properties: { productSku: { type: "string" }, componentName: { type: "string" } }, required: ["productSku", "componentName"] },
    },
    caveats: { type: "array", items: { type: "string" } },
  },
  required: ["hits", "undeclaredComponents", "caveats"],
} as const;

const componentInput = {
  type: "object",
  description: "Add a bill-of-materials component. This is the default action when action is omitted.",
  properties: {
    action: { type: "string", enum: [SUBSTANCES_ACTIONS[0]] }, productId: { type: "string" }, name: { type: "string" },
    parentComponentId: nullableString, partNumber: nullableString, supplierId: nullableString,
    quantity: nullableNumber, unit: nullableString, massGrams: nullableNumber, notes: nullableString,
  },
  required: ["productId", "name"],
} as const;

const declareInput = {
  type: "object",
  description: "Declare a substance on a component. tier defaults to lead; document tier requires supplierDocumentId.",
  properties: {
    action: { type: "string", enum: [SUBSTANCES_ACTIONS[1]] }, componentId: { type: "string" }, substanceName: { type: "string" },
    casNumber: nullableString, ecNumber: nullableString, synonyms: { type: "array", items: { type: "string" } },
    concentrationPpm: nullableNumber, tier: { type: "string", description: "Evidence tier such as lead, human, or document." },
    basis: { type: "string" }, supplierDocumentId: nullableString,
  },
  required: ["action", "componentId", "substanceName"],
} as const;

const loadListInput = {
  type: "object",
  description: "Load a versioned restricted-substance list snapshot.",
  properties: {
    action: { type: "string", enum: [SUBSTANCES_ACTIONS[2]] }, name: { type: "string" }, jurisdiction: { type: "string" },
    authority: nullableString, version: nullableString, sourceUrl: nullableString,
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" }, casNumber: nullableString, thresholdPpm: nullableNumber,
          restriction: { type: "string" }, effectiveOn: { type: "string", format: "date", nullable: true }, citation: nullableString,
        },
        required: ["name"],
      },
    },
  },
  required: ["action", "name", "jurisdiction", "entries"],
} as const;

export function buildSubstancesOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Cante Substances API",
      version: "1.0.0",
      description: "Bill-of-materials components, substance declarations, restriction-list snapshots, and restriction assessments.",
    },
    components: { schemas: { ComponentNode: componentSchema } },
    paths: {
      "/api/substances": {
        get: {
          summary: "Assess a customer's catalogue and optionally return a component tree or substance-text matches.",
          parameters: [
            { name: "customerId", in: "query", required: false, schema: { type: "string" }, description: "Defaults to the workspace customer." },
            { name: "productId", in: "query", required: false, schema: { type: "string" }, description: "Adds components for this product to the response." },
            { name: "matchText", in: "query", required: false, schema: { type: "string" }, description: "Adds catalogue substances named in this text or by CAS number." },
          ],
          responses: {
            "200": {
              description: "If no customer resolves, returns the bare empty assessment fields. Otherwise returns assessment plus optional components and substanceMatches.",
              content: { "application/json": { schema: {
                oneOf: [
                  assessmentSchema,
                  { type: "object", properties: {
                    assessment: assessmentSchema,
                    components: { type: "array", items: componentSchema },
                    substanceMatches: { type: "array", items: { type: "object", properties: {
                      productSku: { type: "string" }, componentName: { type: "string" }, substanceName: { type: "string" }, casNumber: nullableString,
                    }, required: ["productSku", "componentName", "substanceName"] } },
                  }, required: ["assessment"] },
                ],
              } } },
            },
          },
        },
        post: {
          summary: "Add a component, declare a substance, or load a restriction list, selected by action.",
          requestBody: { required: true, content: { "application/json": { schema: { oneOf: [componentInput, declareInput, loadListInput] } } } },
          responses: {
            "200": { description: "Returns { component }, { substance, declaration }, or { listId } for the chosen action." },
            "400": { description: "Malformed JSON, missing required fields, a document declaration without supplierDocumentId, or an unknown action. Unknown-action responses list validActions.", content: { "application/json": { schema: errorSchema } } },
            "500": { description: "A persistence or constraint failure.", content: { "application/json": { schema: errorSchema } } },
          },
        },
        delete: {
          summary: "Delete a component and its substance declarations.",
          parameters: [{ name: "componentId", in: "query", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Returns { deleted: true }." },
            "400": { description: "componentId is missing.", content: { "application/json": { schema: errorSchema } } },
            "500": { description: "A persistence or constraint failure.", content: { "application/json": { schema: errorSchema } } },
          },
        },
      },
    },
  };
}
