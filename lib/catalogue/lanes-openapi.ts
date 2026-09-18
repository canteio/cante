/**
 * Machine-readable contract for /api/lanes. Keep this module storage-free so
 * discovery remains available even when a customer's operating database is
 * unavailable; the route-level tests compare it with real isolated writes.
 */

const errorResponseSchema = {
  type: "object",
  properties: { error: { type: "string" } },
  required: ["error"],
} as const;

const laneSchema = {
  type: "object",
  description: "One origin-to-destination trade movement. Null productId means the lane covers the whole catalogue.",
  properties: {
    id: { type: "string" },
    customerId: { type: "string" },
    productId: { type: ["string", "null"] },
    direction: { type: "string", enum: ["import", "export"] },
    originCountry: { type: "string" },
    destinationCountry: { type: "string" },
    transitCountries: { type: "array", items: { type: "string" } },
    supplierId: { type: ["string", "null"] },
    brokerName: { type: ["string", "null"] },
    brokerContact: { type: ["string", "null"] },
    incoterm: { type: ["string", "null"] },
    shipmentFrequency: {
      type: "string",
      description: "Customer-supplied cadence label. weekly, fortnightly, monthly, quarterly and annually map to exact annual counts; other labels remain unquantified unless annualShipments is supplied.",
    },
    annualShipments: { type: ["integer", "null"] },
    annualValue: { type: ["number", "null"] },
    annualVolume: { type: ["number", "null"] },
    volumeUnit: { type: ["string", "null"] },
    currency: { type: "string" },
    nextShipmentAt: { type: ["string", "null"], description: "Customer-supplied date or timestamp; the current handler does not normalize it." },
    active: { type: "boolean" },
    notes: { type: ["string", "null"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: [
    "id", "customerId", "productId", "direction", "originCountry", "destinationCountry",
    "transitCountries", "supplierId", "shipmentFrequency", "currency", "active", "createdAt", "updatedAt",
  ],
} as const;

const importSummarySchema = {
  type: "object",
  description: "CSV import reports every source row so callers can repair rejected rows rather than trusting a bare total.",
  properties: {
    created: { type: "integer" },
    rejected: { type: "integer" },
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          line: { type: "integer" },
          outcome: { type: "string", enum: ["created", "rejected"] },
          reason: { type: "string" },
          lane: { type: "string" },
        },
        required: ["line", "outcome"],
      },
    },
    caveats: { type: "array", items: { type: "string" } },
  },
  required: ["created", "rejected", "rows", "caveats"],
} as const;

export function buildLanesOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Cante Trade Lanes API",
      version: "1.0.0",
      description:
        "List, create/update, bulk-import and delete customer trade lanes. Values and volumes are customer-supplied inputs, not verified shipment records.",
    },
    paths: {
      "/api/lanes": {
        get: {
          summary: "List a customer's trade lanes.",
          parameters: [
            { name: "customerId", in: "query", required: false, schema: { type: "string" }, description: "Omit to use the default customer if one exists." },
          ],
          responses: {
            "200": {
              description: "An unresolved customer returns { lanes: [] } rather than an error.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { lanes: { type: "array", items: laneSchema } },
                    required: ["lanes"],
                  },
                },
              },
            },
          },
        },
        post: {
          summary: "Create/update one lane, or bulk-import CSV text; mode is selected by the presence of `csv`.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    {
                      type: "object",
                      description: "Single-lane mode. Pass laneId to update; omit it to create. Any direction other than `import` is currently stored as `export`.",
                      not: { required: ["csv"] },
                      properties: {
                        customerId: { type: "string" },
                        laneId: { type: "string" },
                        productId: { type: ["string", "null"] },
                        direction: { type: "string", enum: ["import", "export"], default: "export" },
                        originCountry: { type: "string" },
                        destinationCountry: { type: "string" },
                        transitCountries: { type: "array", items: { type: "string" } },
                        supplierId: { type: ["string", "null"] },
                        brokerName: { type: ["string", "null"] },
                        brokerContact: { type: ["string", "null"] },
                        incoterm: { type: ["string", "null"] },
                        shipmentFrequency: { type: ["string", "null"] },
                        annualShipments: { type: ["number", "null"] },
                        annualValue: { type: ["number", "null"] },
                        annualVolume: { type: ["number", "null"] },
                        volumeUnit: { type: ["string", "null"] },
                        currency: { type: ["string", "null"], default: "USD" },
                        nextShipmentAt: { type: ["string", "null"] },
                        notes: { type: ["string", "null"] },
                      },
                      required: ["originCountry", "destinationCountry"],
                    },
                    {
                      type: "object",
                      description: "CSV-text import mode. Recognized aliases include origin/from, destination/to, sku/product_code/item_code, and supplier/vendor.",
                      properties: { customerId: { type: "string" }, csv: { type: "string" } },
                      required: ["csv"],
                    },
                  ],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Single-lane mode returns { lane }; CSV mode returns { summary } with per-row outcomes.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { lane: laneSchema, summary: importSummarySchema },
                  },
                },
              },
            },
            "400": {
              description: "Malformed JSON, no resolvable customer, or missing originCountry/destinationCountry.",
              content: { "application/json": { schema: errorResponseSchema } },
            },
          },
        },
        delete: {
          summary: "Delete one lane by id.",
          parameters: [
            { name: "customerId", in: "query", required: false, schema: { type: "string" }, description: "Omit to use the default customer if one exists." },
            { name: "laneId", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "deleted is false rather than 404 when the lane does not exist for that customer.",
              content: {
                "application/json": {
                  schema: { type: "object", properties: { deleted: { type: "boolean" } }, required: ["deleted"] },
                },
              },
            },
            "400": { description: "customerId or laneId is missing.", content: { "application/json": { schema: errorResponseSchema } } },
            "500": { description: "Unexpected storage failure.", content: { "application/json": { schema: errorResponseSchema } } },
          },
        },
      },
    },
  };
}
