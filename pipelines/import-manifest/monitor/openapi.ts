import { monitorQueryDocs } from "./query";

/** Maps our hand-written monitorQueryDocs contract (already echoed on every
 * HTTP response as a same-turn self-correction aid, see http.ts/query.ts) into
 * a standard OpenAPI 3.1 parameter list. Kept as a small pure function (not a
 * static JSON file) so it can never drift out of sync with monitorQueryDocs —
 * the single source of truth for the querystring contract. An AI agent that
 * already knows how to read OpenAPI (most do, natively) can now discover this
 * endpoint's shape via a standard /openapi.json instead of having to parse our
 * bespoke `params` field or read source.
 */
function toOpenApiSchema(doc: (typeof monitorQueryDocs)[keyof typeof monitorQueryDocs]) {
  if (doc.type === "enum") {
    return { type: "string", enum: [...doc.values], default: doc.default, example: doc.values[0] };
  }
  if (doc.type === "integer") {
    return { type: "integer", minimum: doc.min, maximum: doc.max, default: doc.default };
  }
  // string
  const schema: Record<string, unknown> = { type: "string" };
  if ("pattern" in doc) schema.pattern = doc.pattern;
  if ("max" in doc) schema.maxLength = doc.max;
  if ("example" in doc) schema.example = doc.example;
  return schema;
}

// Response-body schemas were previously undocumented in the spec — the
// parameter contract was machine-readable but an agent still had to read
// query.ts/model.ts source (or trial-and-error a live request) to learn the
// shape of what comes back. These are hand-written (not derived from the
// zod/TS types) for the same reason monitorQueryDocs is hand-written: a
// stable, prose-friendly contract that doesn't need to track every internal
// refactor of MonitorState/Lead. Keep in sync with model.ts's Lead/
// SourceStatus interfaces and query.ts's searchMonitor() return shape.
const paramsSchema = { type: "object", description: "Echo of the same querystring contract described under this operation's parameters, included on every response so an agent can self-correct without a second lookup." } as const;
const sourceStatusSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["ok", "blocked", "error", "sample"] },
    checkedAt: { type: "string", format: "date-time" },
    dataAsOf: { type: "string", format: "date-time", nullable: true },
    count: { type: "integer" },
    message: { type: "string" },
  },
  required: ["status", "checkedAt", "dataAsOf", "count", "message"],
} as const;
const leadSchema = {
  type: "object",
  description: "One shipment-recall pair.",
  properties: {
    id: { type: "string" }, shipmentId: { type: "string" }, importer: { type: "string" },
    recallId: { type: "string" }, recallUrl: { type: "string", format: "uri" }, recallTitle: { type: "string" },
    recallDate: { type: "string", format: "date" },
    terms: { type: "array", items: { type: "string" }, description: "Cargo-description terms shared with the recall notice." },
    kind: { type: "string", enum: ["named_importer", "commodity_candidate"] },
    firstSeenAt: { type: "string", format: "date-time" },
    newInLatestRun: { type: "boolean" },
    shipment: { type: "object", description: "The matched ImportShipmentRow; see pipelines/import-manifest/schema/shipments.ts." },
  },
  required: ["id", "shipmentId", "importer", "recallId", "recallUrl", "recallTitle", "recallDate", "terms", "kind", "firstSeenAt"],
} as const;
const okResponseSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["never_run", "current", "incomplete"], description: "never_run = worker has not populated data yet; incomplete = coverage is stale/partial, results still returned." },
    updatedAt: { type: "string", format: "date-time", nullable: true },
    sources: { type: "object", nullable: true, properties: { shipments: sourceStatusSchema, recalls: sourceStatusSchema } },
    caveats: { type: "array", items: { type: "string" }, description: "Plain-English coverage/interpretation warnings; render before trusting results." },
    total: { type: "integer", description: "Total matching pairs before offset/limit slicing." },
    results: { type: "array", items: leadSchema },
    params: paramsSchema,
  },
  required: ["status", "updatedAt", "sources", "caveats", "total", "results", "params"],
} as const;
const errorResponseSchema = (extra: Record<string, unknown> = {}) => ({
  type: "object",
  properties: { error: { type: "string" }, params: paramsSchema, ...extra },
  required: ["error", "params"],
});

export function buildImportMonitorOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Cante Import Monitor API",
      version: "1.0.0",
      description:
        "Read-only lead-scoring feed: US CBP ocean manifest shipments cross-matched " +
        "against CPSC/FDA/FSIS recalls. See each parameter's `note`/`description` " +
        "for meaning; every non-200 and every 200 response also echoes this same " +
        "parameter contract under a `params` field for agents that skip spec discovery.",
    },
    paths: {
      "/api/import-monitor": {
        get: {
          summary: "Query recall-matched import leads",
          operationId: "getImportMonitor",
          parameters: Object.entries(monitorQueryDocs).map(([name, doc]) => ({
            name,
            in: "query",
            required: false,
            description: "note" in doc ? doc.note : undefined,
            schema: toOpenApiSchema(doc),
          })),
          responses: {
            "200": {
              description: "Current or incomplete/stale leads for the authenticated workspace.",
              content: { "application/json": { schema: okResponseSchema } },
            },
            "400": {
              description: "Invalid query parameters; body includes `issues` (zod flatten) and `params`.",
              content: { "application/json": { schema: errorResponseSchema({ issues: { type: "object" } }) } },
            },
            "401": {
              description: "No authenticated workspace session; body includes `params`.",
              content: { "application/json": { schema: errorResponseSchema() } },
            },
            "503": {
              description: "Storage temporarily unavailable; body includes `retryable: true` and `params`.",
              content: { "application/json": { schema: errorResponseSchema({ retryable: { type: "boolean", const: true } }) } },
            },
          },
        },
      },
    },
  } as const;
}
