import { checklistStatusSchema } from "./checklist-status";
import { DEFAULT_JURISDICTION, SUPPORTED_JURISDICTIONS } from "@/lib/countries";

const string = { type: "string" } as const;
const nullableString = { type: ["string", "null"] } as const;
const strings = { type: "array", items: string } as const;
const item = {
  type: "object",
  properties: {
    id: string, customerId: string, jurisdiction: string, key: nullableString,
    title: string, category: string,
    // Old persisted rows can predate validation; only PATCH enforces the current enum.
    status: { ...string, description: "Current generated statuses match the PATCH enum; legacy rows may contain other values." },
    priority: string, whyApplies: nullableString, linkedFacts: strings,
    linkedRules: { type: "array", items: { type: "object", properties: { ref: string, title: string, url: string }, required: ["ref"] } },
    evidenceRequired: nullableString, owner: string, dueAt: nullableString,
    lastCheckedAt: nullableString, sourceHealth: string, confidence: string,
    openQuestions: strings, origin: string, createdAt: string, updatedAt: string,
  },
  required: ["id", "customerId", "jurisdiction", "title", "category", "status", "priority", "linkedFacts", "linkedRules", "owner", "sourceHealth", "confidence", "openQuestions", "origin", "createdAt", "updatedAt"],
} as const;
const list = {
  type: "object",
  properties: {
    items: { type: "array", items: item },
    jurisdiction: { type: "string", enum: SUPPORTED_JURISDICTIONS.map(({ name }) => name) },
  },
  // GET deliberately omits jurisdiction when no customer resolves.
  required: ["items"],
} as const;
const error = { type: "object", properties: { error: string }, required: ["error"] } as const;
const country = {
  type: "string", default: DEFAULT_JURISDICTION,
  description: "United States or Indonesia. US/USA/ID aliases are accepted; missing or unrecognized values default to United States.",
} as const;
const customerId = {
  type: "string",
  description: "Optional workspace selector. Supabase auth restricts this to the authenticated workspace; otherwise omission selects the default local customer.",
} as const;
const json = <T>(schema: T) => ({ "application/json": { schema } });

export function buildChecklistOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: { title: "Cante checklist API", version: "1.0.0", description: "Use the deployment's normal authentication. This document describes route-handler responses; middleware can reject unauthenticated requests." },
    paths: {
      "/api/checklist": {
        get: {
          operationId: "listChecklist", summary: "List obligations for a customer and country",
          description: "An empty stored checklist triggers regeneration, so GET can write rows. No resolved customer returns {items: []} without jurisdiction.",
          parameters: [
            { name: "customerId", in: "query", required: false, schema: customerId },
            { name: "country", in: "query", required: false, schema: country },
          ],
          responses: { "200": { description: "Checklist rows", content: json(list) }, "500": { description: "Unhandled storage or regeneration failure; JSON is not guaranteed." } },
        },
        post: {
          operationId: "refreshChecklist", summary: "Regenerate checklist obligations",
          requestBody: { required: true, content: json({ type: "object", properties: { customerId, country } }) },
          responses: {
            "200": { description: "Regenerated checklist", content: json({ ...list, required: ["items", "jurisdiction"] }) },
            "404": { description: "No customer could be resolved", content: json(error) },
            "500": { description: "Unhandled storage, regeneration, or invalid-body failure; JSON is not guaranteed." },
          },
        },
        patch: {
          operationId: "updateChecklistStatus", summary: "Set a checklist item's status",
          description: "IDs are trimmed. A successful response does not prove a row existed; unknown IDs also return ok: true. Use completed, needs_review, or not_applicable for the UI's three actions.",
          requestBody: { required: true, content: json({
            type: "object", properties: {
              id: { type: "string", minLength: 1, pattern: "\\S", description: "ID from GET; must contain a non-whitespace character." },
              status: { type: "string", enum: checklistStatusSchema.options },
            }, required: ["id", "status"],
          }) },
          responses: {
            "200": { description: "Update executed", content: json({ type: "object", properties: { ok: { const: true } }, required: ["ok"] }) },
            "400": { description: "Invalid JSON, ID, or status. Includes correction guidance and Zod issues.", content: json({
              type: "object", properties: {
                error: string,
                shape: { type: "object", properties: {
                  id: { type: "object" },
                  status: { type: "object", properties: { enum: { type: "array", items: { type: "string", enum: checklistStatusSchema.options } } }, required: ["enum"] },
                }, required: ["id", "status"] },
                issues: { type: "array", items: { type: "object" }, minItems: 1 },
              }, required: ["error", "shape", "issues"],
            }) },
            "500": { description: "Storage failure", content: json(error) },
          },
        },
      },
    },
  };
}
