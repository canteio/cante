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
            "200": { description: "Current or incomplete/stale leads for the authenticated workspace." },
            "400": { description: "Invalid query parameters; body includes `issues` (zod flatten) and `params`." },
            "401": { description: "No authenticated workspace session; body includes `params`." },
            "503": { description: "Storage temporarily unavailable; body includes `retryable: true` and `params`." },
          },
        },
      },
    },
  } as const;
}
