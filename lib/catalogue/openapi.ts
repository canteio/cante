/**
 * Machine-readable contract for /api/products, mirroring the pattern
 * established for /api/workqueue, /api/import-monitor and /api/suppliers: a
 * standard OpenAPI 3.1 discovery document served at /api/products/openapi so
 * an AI agent consuming this endpoint doesn't have to reverse-engineer the
 * shape from source or trial-and-error requests. This route has the widest
 * POST surface of the four (single-product upsert, JSON CSV import, and
 * multipart file upload all share one handler) and was the next item flagged
 * in the API/schema audit's "still unaudited" list (see
 * cante/company-plan, 2026-09-17 note).
 *
 * `productClass` enum is inlined here rather than imported from
 * lib/catalogue/products.ts because PRODUCT_CLASSES there is module-private
 * (not exported) — kept in sync by hand like the other hand-written specs;
 * a future refactor could export it for the same anti-drift guarantee the
 * workqueue/suppliers specs get from their exported enums.
 */

const errorResponseSchema = {
  type: "object",
  properties: { error: { type: "string" } },
  required: ["error"],
} as const;

const productSchema = {
  type: "object",
  description: "One SKU in a customer's product catalogue. See lib/db/schema.ts `products`.",
  properties: {
    id: { type: "string" },
    customerId: { type: "string" },
    sku: { type: "string" },
    name: { type: "string" },
    description: { type: ["string", "null"] },
    materials: { type: "array", items: { type: "string" } },
    originCountry: { type: ["string", "null"] },
    unitOfMeasure: { type: ["string", "null"] },
    unitValue: { type: ["number", "null"] },
    currency: { type: "string" },
    productClass: { type: "string", enum: ["consumer", "industrial", "component", "unknown"] },
    notes: { type: ["string", "null"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: ["id", "customerId", "sku", "name", "currency", "productClass", "createdAt", "updatedAt"],
} as const;

const classificationSchema = {
  type: "object",
  description: "One HS/tariff classification attached to a product. Superseded rows are filtered out of GET responses.",
  properties: {
    id: { type: "string" },
    productId: { type: "string" },
    code: { type: "string" },
    tier: { type: "string", description: "document | human | lead | guess — see lib/checks/facts.ts." },
    supersededAt: { type: ["string", "null"], format: "date-time" },
  },
  required: ["id", "productId", "code"],
} as const;

const productWithClassificationsSchema = {
  allOf: [
    productSchema,
    {
      type: "object",
      properties: { classifications: { type: "array", items: classificationSchema } },
      required: ["classifications"],
    },
  ],
} as const;

const importRowOutcomeSchema = {
  type: "object",
  description: "Per-row outcome for a CSV/file import. Every row is reported — never a bare count — so a caller can act on exactly which SKUs were dropped and why.",
  properties: {
    line: { type: "integer" },
    sku: { type: "string" },
    outcome: { type: "string", enum: ["created", "updated", "unchanged", "rejected"] },
    reason: { type: "string" },
    codesRecorded: { type: "array", items: { type: "string" } },
  },
  required: ["line", "sku", "outcome"],
} as const;

const importSummarySchema = {
  type: "object",
  properties: {
    created: { type: "integer" },
    updated: { type: "integer" },
    unchanged: { type: "integer" },
    rejected: { type: "integer" },
    rows: { type: "array", items: importRowOutcomeSchema },
    recognisedColumns: { type: "array", items: { type: "string" } },
    ignoredColumns: { type: "array", items: { type: "string" } },
    caveats: { type: "array", items: { type: "string" } },
  },
  required: ["created", "updated", "unchanged", "rejected", "rows", "recognisedColumns", "ignoredColumns", "caveats"],
} as const;

export function buildProductsOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Cante Products API",
      version: "1.0.0",
      description:
        "Customer product catalogue: list/upsert/delete one SKU, or bulk-import a whole catalogue via a JSON `csv` field or an uploaded spreadsheet/PDF (multipart `file`). A spreadsheet or CSV import can only ever produce `lead`-tier classifications, never verified document-tier classifications.",
    },
    paths: {
      "/api/products": {
        get: {
          summary: "List the customer's product catalogue with current (non-superseded) classifications attached.",
          parameters: [
            { name: "customerId", in: "query", required: false, schema: { type: "string" }, description: "Omit to use the default customer if one exists." },
          ],
          responses: {
            "200": {
              description: "An unresolved customerId returns `{ products: [] }` rather than an error.",
              content: { "application/json": { schema: { type: "object", properties: { products: { type: "array", items: productWithClassificationsSchema } }, required: ["products"] } } },
            },
          },
        },
        post: {
          summary: "Upsert one product (JSON), bulk-import CSV text (JSON `csv` field), or upload a file (multipart `file`) — mode is inferred from the request, not an `action` field.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    {
                      type: "object",
                      description: "Single-product upsert mode, keyed on `sku`.",
                      not: { required: ["csv"] },
                      properties: {
                        customerId: { type: "string" },
                        sku: { type: "string" },
                        name: { type: "string" },
                        description: { type: ["string", "null"] },
                        materials: { type: "array", items: { type: "string" } },
                        originCountry: { type: ["string", "null"] },
                        unitOfMeasure: { type: ["string", "null"] },
                        unitValue: { type: ["number", "null"] },
                        currency: { type: "string" },
                        productClass: { type: "string", enum: ["consumer", "industrial", "component", "unknown"] },
                        notes: { type: ["string", "null"] },
                      },
                      required: ["sku", "name"],
                    },
                    {
                      type: "object",
                      description: "CSV-as-text import mode.",
                      properties: { customerId: { type: "string" }, csv: { type: "string" } },
                      required: ["csv"],
                    },
                  ],
                },
              },
              "multipart/form-data": {
                schema: {
                  type: "object",
                  description: "File-upload import mode. The file (.csv/.xlsx/.pdf) is text-extracted then run through the same importer as the JSON `csv` mode.",
                  properties: {
                    customerId: { type: "string" },
                    file: { type: "string", format: "binary" },
                  },
                  required: ["file"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Shape depends on mode: single upsert -> { product, outcome } (SQLite backend) or { product: <row>, outcome } (Supabase backend); csv/file import -> { summary } or { summary, extraction }.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      product: productSchema,
                      outcome: { type: "string", enum: ["created", "updated", "unchanged"] },
                      summary: importSummarySchema,
                      extraction: {
                        type: "object",
                        properties: { format: { type: "string" }, warnings: { type: "array", items: { type: "string" } } },
                      },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Malformed JSON/multipart body, no file attached, no customer could be resolved, missing sku/name, or a file-extraction failure.",
              content: { "application/json": { schema: errorResponseSchema } },
            },
          },
        },
        delete: {
          summary: "Delete one product by id.",
          parameters: [
            { name: "customerId", in: "query", required: false, schema: { type: "string" } },
            { name: "productId", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "`deleted` is false rather than a 404 when the id didn't match an existing row for that customer.", content: { "application/json": { schema: { type: "object", properties: { deleted: { type: "boolean" } }, required: ["deleted"] } } } },
            "400": { description: "Missing customerId or productId.", content: { "application/json": { schema: errorResponseSchema } } },
            "500": { description: "Unexpected failure (e.g. Supabase client error).", content: { "application/json": { schema: errorResponseSchema } } },
          },
        },
      },
    },
  };
}
