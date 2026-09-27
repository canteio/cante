import { EVIDENCE_TYPES } from "./contract";

/**
 * Machine-readable contract for /api/suppliers, mirroring the pattern
 * established for /api/workqueue and /api/import-monitor: a standard
 * OpenAPI 3.1 discovery document served at /api/suppliers/openapi so an AI
 * agent consuming this endpoint doesn't have to reverse-engineer the shape
 * from source or trial-and-error requests. This route joined three concerns
 * (suppliers, evidence docs, screening) with a 4-action POST body but had no
 * discovery endpoint despite the bar already being set elsewhere — closes
 * that gap (see cante/company-plan API/schema audit, 2026-09-17/18).
 *
 * Kept hand-written for the same reason as the other specs: a stable,
 * prose-friendly contract that survives internal refactors. `docType` enum is
 * pulled from the storage-independent supplier contract so route validation and
 * discovery cannot drift, while discovery stays usable without a database.
 */

const evidenceStatusSchema = {
  type: "string",
  enum: ["not_requested", "requested", "received", "expired", "rejected", "not_applicable"],
} as const;

const docTypeSchema = { type: "string", enum: EVIDENCE_TYPES } as const;

const supplierSchema = {
  type: "object",
  description: "A counterparty (supplier, manufacturer, broker, forwarder, consignee, or other). See lib/db/schema.ts `suppliers`.",
  properties: {
    id: { type: "string" },
    customerId: { type: "string" },
    name: { type: "string" },
    country: { type: "string", nullable: true },
    address: { type: "string", nullable: true },
    contactEmail: { type: "string", nullable: true },
    role: { type: "string", description: "supplier | manufacturer | broker | forwarder | consignee | other" },
    active: { type: "boolean" },
    notes: { type: "string", nullable: true },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: ["id", "customerId", "name", "role", "active", "createdAt", "updatedAt"],
} as const;

const supplierDocumentSchema = {
  type: "object",
  description: "One piece of evidence owed by (or received from) a supplier. See lib/db/schema.ts `supplierDocuments`.",
  properties: {
    id: { type: "string" },
    supplierId: { type: "string" },
    productId: { type: "string", nullable: true, description: "Null when the document covers the whole supplier rather than one SKU." },
    docType: docTypeSchema,
    status: evidenceStatusSchema,
    requestedAt: { type: "string", nullable: true, format: "date-time" },
    receivedAt: { type: "string", nullable: true, format: "date-time" },
    expiresAt: { type: "string", nullable: true, format: "date" },
    fileRef: { type: "string", nullable: true },
    notes: { type: "string", nullable: true },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: ["id", "supplierId", "docType", "status", "createdAt", "updatedAt"],
} as const;

const screeningResultSchema = {
  type: "object",
  description: "One restricted-party screening event against the US Consolidated Screening List. `outcome: error` is first-class — a failed screen must never be read as clear. See lib/screening/persist.ts.",
  properties: {
    id: { type: "string" },
    customerId: { type: "string" },
    supplierId: { type: "string", nullable: true },
    screenedName: { type: "string" },
    provider: { type: "string" },
    outcome: { type: "string", enum: ["clear", "match", "error"] },
    matchCount: { type: "integer" },
    matches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          source: { type: "string" },
          url: { type: "string", nullable: true },
          addresses: { type: "array", items: { type: "string" } },
        },
      },
    },
    errorMessage: { type: "string", nullable: true },
    listVersion: { type: "string", nullable: true },
    screenedAt: { type: "string", format: "date-time" },
  },
  required: ["id", "customerId", "screenedName", "provider", "outcome", "matchCount", "screenedAt"],
} as const;

const evidenceGapSchema = {
  type: "object",
  description: "One outstanding evidence item across all suppliers for a customer. See lib/suppliers/evidence.ts evidenceGaps().",
  properties: {
    supplier: supplierSchema,
    docType: { type: "string", description: "One of EVIDENCE_TYPES, or \"any\" when nothing has ever been requested from this supplier." },
    status: evidenceStatusSchema,
    detail: { type: "string", description: "Plain-language why this matters." },
    severity: { type: "string", enum: ["high", "medium", "low"] },
    expiresAt: { type: "string", nullable: true, format: "date" },
  },
  required: ["supplier", "docType", "status", "detail", "severity"],
} as const;

const suggestionSchema = {
  type: "object",
  description: "A keyword-triggered prompt to ask for evidence, never a determination that a rule applies. See lib/suppliers/evidence.ts suggestedEvidence().",
  properties: {
    sku: { type: "string" },
    docType: docTypeSchema,
    why: { type: "string" },
  },
  required: ["sku", "docType", "why"],
} as const;

const screeningCoverageSchema = {
  type: "object",
  description: "Who is and is not covered by screening. `neverScreened` is the field that matters most. See lib/screening/persist.ts screeningCoverage().",
  properties: {
    totalSuppliers: { type: "integer" },
    neverScreened: { type: "array", items: { type: "string" } },
    staleScreenings: {
      type: "array",
      items: { type: "object", properties: { name: { type: "string" }, screenedAt: { type: "string", format: "date-time" }, ageDays: { type: "integer" } } },
    },
    currentMatches: {
      type: "array",
      items: { type: "object", properties: { name: { type: "string" }, matchCount: { type: "integer" } } },
    },
    erroredScreenings: { type: "array", items: { type: "string" } },
  },
  required: ["totalSuppliers", "neverScreened", "staleScreenings", "currentMatches", "erroredScreenings"],
} as const;

const errorResponseSchema = { type: "object", properties: { error: { type: "string" } }, required: ["error"] } as const;

export function buildSuppliersOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Cante Suppliers API",
      version: "1.0.0",
      description:
        "Suppliers, the evidence documents owed by/received from them, and their restricted-party " +
        "screening status, joined into one GET. POST is a 4-action endpoint: upsert a supplier, " +
        "record/update an evidence document, record that evidence was requested (drafts only — " +
        "nothing is actually sent), or run a restricted-party screen.",
    },
    paths: {
      "/api/suppliers": {
        get: {
          summary: "List suppliers for a customer, each with its documents and latest screening, plus coverage/gap/suggestion summaries.",
          parameters: [
            { name: "customerId", in: "query", required: false, schema: { type: "string" }, description: "Defaults to the workspace's default customer if omitted." },
          ],
          responses: {
            "200": {
              description: "Empty { suppliers: [] } (no gaps/suggestions/coverage keys) if no customer resolves.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      suppliers: {
                        type: "array",
                        items: {
                          allOf: [
                            supplierSchema,
                            {
                              type: "object",
                              properties: {
                                documents: { type: "array", items: supplierDocumentSchema },
                                latestScreening: { ...screeningResultSchema, nullable: true },
                              },
                            },
                          ],
                        },
                      },
                      gaps: { type: "array", items: evidenceGapSchema },
                      suggestions: { type: "array", items: suggestionSchema },
                      screeningCoverage: screeningCoverageSchema,
                    },
                    required: ["suppliers"],
                  },
                },
              },
            },
          },
        },
        post: {
          summary: "Upsert a supplier, record evidence, record an evidence request, or run a screen — selected by `action`.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    {
                      type: "object",
                      description: "Upsert mode (default when `action` is omitted): create or update a supplier.",
                      properties: {
                        customerId: { type: "string" },
                        action: { type: "string", enum: ["upsert"] },
                        supplierId: { type: "string", description: "Omit to create a new supplier." },
                        name: { type: "string" },
                        country: { type: "string", nullable: true },
                        address: { type: "string", nullable: true },
                        contactEmail: { type: "string", nullable: true },
                        role: { type: "string", nullable: true },
                        notes: { type: "string", nullable: true },
                      },
                      required: ["name"],
                    },
                    {
                      type: "object",
                      description: "Evidence mode: record or update one evidence document.",
                      properties: {
                        customerId: { type: "string" },
                        action: { type: "string", enum: ["evidence"] },
                        supplierId: { type: "string" },
                        docType: docTypeSchema,
                        productId: { type: "string", nullable: true },
                        status: evidenceStatusSchema,
                        expiresAt: { type: "string", nullable: true, format: "date" },
                        fileRef: { type: "string", nullable: true },
                        notes: { type: "string", nullable: true },
                      },
                      required: ["action", "supplierId", "docType"],
                    },
                    {
                      type: "object",
                      description: "Request mode: mark evidence as requested and return a draft message. Nothing is actually sent (`delivered: false` always).",
                      properties: {
                        customerId: { type: "string" },
                        action: { type: "string", enum: ["request"] },
                        supplierId: { type: "string" },
                        docType: docTypeSchema,
                        productId: { type: "string", nullable: true },
                      },
                      required: ["action", "supplierId", "docType"],
                    },
                    {
                      type: "object",
                      description: "Screen mode: run a restricted-party screen for one supplier now.",
                      properties: {
                        customerId: { type: "string" },
                        action: { type: "string", enum: ["screen"] },
                        supplierId: { type: "string" },
                      },
                      required: ["action", "supplierId"],
                    },
                  ],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Shape depends on `action`: upsert -> { supplier }; evidence -> { document }; request -> { record, draftMessage, delivered: false }; screen -> ScreenSupplierResult ({ row, clear }).",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      supplier: supplierSchema,
                      document: supplierDocumentSchema,
                      record: supplierDocumentSchema,
                      draftMessage: { type: "string" },
                      delivered: { type: "boolean", enum: [false] },
                      row: screeningResultSchema,
                      clear: { type: "boolean", description: "True only when the upstream screen succeeded and returned no match." },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Malformed JSON body, no customer could be resolved, missing required field for the chosen action, an EvidenceError (unsupported document type or status), or an unknown `action` (response lists `validActions`).",
              content: { "application/json": { schema: errorResponseSchema } },
            },
            "500": { description: "Unexpected failure (e.g. screening upstream call, supplier not found in screen mode).", content: { "application/json": { schema: errorResponseSchema } } },
          },
        },
      },
    },
  };
}
