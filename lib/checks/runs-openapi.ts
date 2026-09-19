import { SUPPORTED_JURISDICTIONS } from "@/lib/countries";
import { PROVIDER_OPTIONS } from "@/lib/llm/provider-choice";

const nullableString = { type: ["string", "null"] } as const;
const errorSchema = {
  type: "object",
  properties: { error: { type: "string" } },
  required: ["error"],
} as const;
const runErrorSchema = {
  type: "object",
  properties: { ok: { const: false }, error: { type: "string" } },
  required: ["ok", "error"],
} as const;

const jurisdictionSchema = {
  type: "string",
  enum: SUPPORTED_JURISDICTIONS.map(({ name }) => name),
  default: "United States",
} as const;

const checkRunSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    customerId: { type: "string" },
    jurisdiction: jurisdictionSchema,
    startedAt: { type: "string", format: "date-time" },
    completedAt: nullableString,
    status: { type: "string", enum: ["running", "complete", "failed"] },
    errorMessage: nullableString,
  },
  required: ["id", "customerId", "jurisdiction", "startedAt", "completedAt", "status", "errorMessage"],
} as const;

const sourceResultSchema = {
  type: "object",
  properties: {
    id: { type: "string" }, sourceId: { type: "string" }, success: { type: "boolean" },
    errorMessage: nullableString, entriesParsed: { type: "integer" }, parseWarning: nullableString,
    sourceName: nullableString, domain: nullableString, view: nullableString,
  },
  required: ["id", "sourceId", "success", "errorMessage", "entriesParsed", "parseWarning", "sourceName", "domain", "view"],
} as const;

const findingSchema = {
  type: "object",
  properties: {
    id: { type: "string" }, checkRunId: { type: "string" }, customerId: { type: "string" },
    sourceId: nullableString, regulationRef: nullableString, title: { type: "string" }, url: nullableString,
    enactedOn: nullableString, summaryId: nullableString, summaryEn: nullableString,
    relevance: { type: "string", enum: ["flagged", "noted", "baseline", "clear"] },
    reasoning: nullableString, createdAt: { type: "string", format: "date-time" },
  },
  required: ["id", "checkRunId", "customerId", "sourceId", "regulationRef", "title", "url", "enactedOn", "summaryId", "summaryEn", "relevance", "reasoning", "createdAt"],
} as const;

const alertSchema = {
  oneOf: [
    { type: "null" },
    {
      type: "object",
      properties: {
        id: { type: "string" }, findingId: nullableString, customerId: { type: "string" },
        checkRunId: nullableString, body: { type: "string" },
        channel: { type: "string", enum: ["whatsapp", "telegram", "email", "manual"] },
        deliveryStatus: { type: "string", enum: ["pending", "delivered", "failed", "skipped"] },
        deliveredAt: nullableString, deliveryError: nullableString,
        deliveryAttempts: { type: "integer" }, createdAt: { type: "string", format: "date-time" },
      },
      required: ["id", "findingId", "customerId", "checkRunId", "body", "channel", "deliveryStatus", "deliveredAt", "deliveryError", "deliveryAttempts", "createdAt"],
    },
  ],
} as const;

/** Build discovery without importing customer storage or the long-running check runner. */
export function buildChecksOpenApiSpec() {
  const historyEntrySchema = {
    type: "object",
    properties: {
      run: checkRunSchema,
      sourceResults: { type: "array", items: sourceResultSchema },
      findings: { type: "array", items: findingSchema },
      alert: alertSchema,
    },
    required: ["run", "sourceResults", "findings", "alert"],
  } as const;

  return {
    openapi: "3.1.0",
    info: {
      title: "Cante compliance checks API",
      version: "1.0.0",
      description: "Read the latest 30 compliance runs or start a local check. Production Supabase deployments must use the trusted local scheduler.",
    },
    paths: {
      "/api/checks": {
        get: {
          summary: "List recent compliance runs with their source evidence, findings, and alert.",
          parameters: [
            { name: "customerId", in: "query", required: false, schema: { type: "string" }, description: "Customer workspace ID. The local default customer is used when omitted." },
            { name: "country", in: "query", required: false, schema: jurisdictionSchema, description: "Jurisdiction name or supported US/Indonesia alias." },
          ],
          responses: {
            "200": {
              description: "The latest 30 runs for the resolved customer and jurisdiction.",
              content: { "application/json": { schema: {
                type: "object",
                properties: {
                  customerId: { type: "string" }, jurisdiction: jurisdictionSchema,
                  runs: { type: "array", items: historyEntrySchema },
                },
                required: ["customerId", "jurisdiction", "runs"],
              } } },
            },
            "404": { description: "No customer workspace could be resolved.", content: { "application/json": { schema: errorSchema } } },
          },
        },
        post: {
          summary: "Start one compliance check on the local data backend.",
          description: "This can take several minutes. Supabase-backed production rejects direct calls because the trusted local scheduler runs and verifies checks before syncing them.",
          requestBody: {
            required: false,
            content: { "application/json": { schema: {
              type: "object",
              properties: {
                customerId: { type: "string" },
                country: jurisdictionSchema,
                provider: {
                  type: "string",
                  enum: PROVIDER_OPTIONS.map(({ id }) => id),
                  default: "claude-code",
                  description: "Canonical provider choice. Common aliases such as codex, chatgpt, gemini, and agy are also normalized by the route.",
                },
              },
            } } },
          },
          responses: {
            "200": { description: "The check completed and persisted its run.", content: { "application/json": { schema: {
              type: "object",
              properties: { ok: { const: true }, runId: { type: "string" }, jurisdiction: jurisdictionSchema },
              required: ["ok", "runId", "jurisdiction"],
            } } } },
            "404": { description: "No customer workspace could be resolved.", content: { "application/json": { schema: errorSchema } } },
            "409": { description: "Direct checks are disabled on the Supabase backend.", content: { "application/json": { schema: runErrorSchema } } },
            "500": { description: "The check failed. The run row contains the same failure when a run was created.", content: { "application/json": { schema: runErrorSchema } } },
          },
        },
      },
    },
  };
}
