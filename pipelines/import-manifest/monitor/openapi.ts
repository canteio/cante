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

// Worked response examples for an AI agent consuming the spec cold: schemas alone
// describe shape, not "what does a realistic populated response actually look
// like" — an agent reading OpenAPI natively (per the file header above) can use
// these directly rather than having to synthesize a mental model from `properties`
// nesting. Values are clearly synthetic (obviously placeholder company/recall
// names), matching the repo's standing rule that examples/fixtures must never
// look like real discovered data (see monitor.test.ts / sources.ts sample-marker
// pattern) — this is spec documentation, not a shipped record.
const okExample = {
  status: "current",
  updatedAt: "2026-09-14T07:20:00.000Z",
  sources: {
    shipments: { status: "ok", checkedAt: "2026-09-14T07:20:00.000Z", dataAsOf: "2026-09-13T00:00:00.000Z", count: 412, message: "Loaded authorized export." },
    recalls: { status: "ok", checkedAt: "2026-09-14T07:20:00.000Z", dataAsOf: "2026-09-14T06:00:00.000Z", count: 58, message: "Fetched from CPSC API." },
  },
  caveats: [
    "Ocean manifests only; confidentiality redactions and unknown parties reduce coverage.",
    "Named importer means an exact normalized CPSC importer name plus commodity overlap; verify the linked recall.",
  ],
  total: 1,
  results: [{
    id: "example-lead-id", shipmentId: "example-shipment-id", importer: "Example Imports Inc.",
    recallId: "26-000", recallUrl: "https://www.cpsc.gov/Recalls/example", recallTitle: "Example product recalled (illustrative only)",
    recallDate: "2026-09-01", terms: ["stroller"], kind: "named_importer", firstSeenAt: "2026-09-10T00:00:00.000Z", newInLatestRun: true,
    shipment: { id: "example-shipment-id", billOfLading: "EXAMPLE-BOL", shipperCountryCode: "CN", cargoDescription: "baby stroller", manifestFiledDate: "2026-09-05" },
  }],
  params: monitorQueryDocs,
};
const errorExample = (extra: Record<string, unknown> = {}) => ({ error: "Invalid query parameters", params: monitorQueryDocs, ...extra });

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
              content: { "application/json": { schema: okResponseSchema, examples: { current: { summary: "One named-importer lead (synthetic)", value: okExample } } } },
            },
            "400": {
              description: "Invalid query parameters; body includes `issues` (zod flatten) and `params`.",
              content: { "application/json": { schema: errorResponseSchema({ issues: { type: "object" } }),
                examples: { badCountry: { summary: "country failed the ^[A-Z]{2}$ pattern", value: errorExample({ issues: { fieldErrors: { country: ["Invalid"] }, formErrors: [] } }) } } } },
            },
            "401": {
              description: "No authenticated workspace session; body includes `params`.",
              content: { "application/json": { schema: errorResponseSchema(),
                examples: { unauthenticated: { summary: "No workspace session", value: errorExample({ error: "Workspace authentication required." }) } } } },
            },
            "503": {
              description: "Storage temporarily unavailable; body includes `retryable: true` and `params`.",
              content: { "application/json": { schema: errorResponseSchema({ retryable: { type: "boolean", const: true } }),
                examples: { storageOutage: { summary: "Retryable storage failure", value: errorExample({ error: "Import monitoring storage is unavailable.", retryable: true }) } } } },
            },
          },
        },
      },
    },
  } as const;
}
