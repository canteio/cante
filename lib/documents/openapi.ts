import { DOCUMENTS_ACTIONS, DOCUMENT_TYPES } from "./contract";

const nullableString = { type: ["string", "null"] } as const;
const nullableNumber = { type: ["number", "null"] } as const;
const errorSchema = {
  type: "object",
  properties: { error: { type: "string" } },
  required: ["error"],
} as const;

const extractedLineSchema = {
  type: "object",
  properties: {
    lineNumber: { type: "integer" },
    sku: nullableString,
    description: { type: "string" },
    hsCode: nullableString,
    originCountry: nullableString,
    quantity: nullableNumber,
    unitOfMeasure: nullableString,
    unitValue: nullableNumber,
    lineValue: nullableNumber,
  },
  required: ["lineNumber", "sku", "description", "hsCode", "originCountry", "quantity", "unitOfMeasure", "unitValue", "lineValue"],
} as const;

const extractedDocumentSchema = {
  type: ["object", "null"],
  properties: {
    documentNumber: nullableString,
    documentDate: nullableString,
    exporter: nullableString,
    consignee: nullableString,
    originCountry: nullableString,
    destinationCountry: nullableString,
    currency: nullableString,
    totalValue: nullableNumber,
    lines: { type: "array", items: extractedLineSchema },
  },
  required: ["documentNumber", "documentDate", "exporter", "consignee", "originCountry", "destinationCountry", "currency", "totalValue", "lines"],
} as const;

const documentSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    customerId: { type: "string" },
    docType: { type: "string", enum: DOCUMENT_TYPES },
    filename: { type: "string" },
    documentNumber: nullableString,
    documentDate: nullableString,
    parseStatus: { type: "string", enum: ["parsed", "partial", "unparsed", "failed"] },
    parseNote: nullableString,
    extracted: extractedDocumentSchema,
    rawText: nullableString,
    uploadedAt: { type: "string", format: "date-time" },
  },
  required: ["id", "customerId", "docType", "filename", "documentNumber", "documentDate", "parseStatus", "parseNote", "extracted", "rawText", "uploadedAt"],
} as const;

const findingSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    documentId: { type: "string" },
    productId: nullableString,
    kind: { type: "string", enum: ["code_mismatch", "origin_mismatch", "description_mismatch", "value_mismatch", "missing_field", "uom_mismatch"] },
    severity: { type: "string", enum: ["high", "medium", "low"] },
    message: { type: "string" },
    documentValue: nullableString,
    expectedValue: nullableString,
    expectationTier: { type: "string", enum: ["lead", "ai", "human", "document"] },
    status: { type: "string", enum: ["open", "accepted", "dismissed", "corrected"] },
    dutyDifference: nullableNumber,
    dutyCurrency: { type: "string", enum: ["USD"] },
    dutyBasis: { type: "array", items: { type: "string" } },
    createdAt: { type: "string", format: "date-time" },
  },
  required: ["id", "documentId", "productId", "kind", "severity", "message", "documentValue", "expectedValue", "expectationTier", "status", "dutyDifference", "dutyCurrency", "dutyBasis", "createdAt"],
} as const;

const findingsResponseSchema = {
  type: "object",
  properties: { findings: { type: "array", items: findingSchema } },
  required: ["findings"],
} as const;

/** Build discovery without importing customer storage, file parsers, or tariff clients. */
export function buildDocumentsOpenApiSpec() {
  const jsonRequestSchema = {
    oneOf: [
      {
        type: "object",
        properties: {
          action: { const: "ingest" }, customerId: { type: "string" },
          docType: { type: "string", enum: DOCUMENT_TYPES, default: "other" },
          filename: { type: "string", default: "pasted.txt" }, text: { type: "string" },
          country: { type: "string" },
        },
        required: ["text"],
      },
      ...(["audit", "price", "promote"] as const).map((action) => ({
        type: "object" as const,
        properties: {
          action: { const: action }, customerId: { type: "string" }, documentId: { type: "string" },
        },
        required: ["action", "documentId"],
      })),
    ],
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "Cante trade documents API",
      version: "1.0.0",
      description: "Ingest trade-document text or files, inspect parse and audit results, rerun audits, price discrepancies, and promote document-backed classification codes for human approval. OCR is not supported.",
    },
    paths: {
      "/api/documents": {
        get: {
          summary: "List documents or fetch one document with its findings.",
          description: "Without documentId, returns the resolved customer's documents. With documentId, returns that document and its findings. An unresolved customer produces an empty list.",
          parameters: [
            { name: "customerId", in: "query", required: false, schema: { type: "string" }, description: "Customer workspace ID. The local default customer is used when omitted." },
            { name: "documentId", in: "query", required: false, schema: { type: "string" }, description: "Select one document and include its findings." },
          ],
          responses: {
            "200": { description: "A document list or one document with findings.", content: { "application/json": { schema: { oneOf: [
              { type: "object", properties: { documents: { type: "array", items: documentSchema } }, required: ["documents"] },
              { type: "object", properties: { document: documentSchema, findings: { type: "array", items: findingSchema } }, required: ["document", "findings"] },
            ] } } } },
            "404": { description: "documentId did not match a stored document.", content: { "application/json": { schema: errorSchema } } },
            "500": { description: "Storage failed while reading documents.", content: { "application/json": { schema: errorSchema } } },
          },
        },
        post: {
          summary: "Ingest a document or run a follow-up document action.",
          description: `JSON actions are ${DOCUMENTS_ACTIONS.join(", ")}. Ingest is the default. Supabase accepts ingest but returns 409 for audit, price, and promote because those run on the trusted worker. Multipart uploads accept PDF, XLSX, DOCX, CSV, or text with an extractable text layer; scanned files need OCR before upload.`,
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: jsonRequestSchema },
              "multipart/form-data": { schema: {
                type: "object",
                properties: {
                  file: { type: "string", format: "binary" }, customerId: { type: "string" },
                  country: { type: "string" }, docType: { type: "string", enum: DOCUMENT_TYPES, default: "other" },
                },
                required: ["file"],
              } },
            },
          },
          responses: {
            "200": { description: "The ingested document, audit or pricing findings, or promoted and skipped classification details.", content: { "application/json": { schema: { oneOf: [
              { type: "object", properties: { document: documentSchema, findings: { type: "array", items: findingSchema } }, required: ["document", "findings"] },
              findingsResponseSchema,
              {
                type: "object",
                properties: {
                  promoted: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: { sku: { type: "string" }, code: { type: "string" } },
                      required: ["sku", "code"],
                    },
                  },
                  skipped: { type: "array", items: { type: "string" } },
                },
                required: ["promoted", "skipped"],
              },
            ] } } } },
            "400": { description: "Malformed JSON or multipart data, unresolved customer, unsupported document content or type, missing documentId, or unknown action. Unknown actions also return validActions.", content: { "application/json": { schema: { oneOf: [
              errorSchema,
              { type: "object", properties: { error: { type: "string" }, validActions: { type: "array", items: { type: "string", enum: DOCUMENTS_ACTIONS } } }, required: ["error", "validActions"] },
            ] } } } },
            "409": { description: "The Supabase backend requires the trusted worker for audit, price, and promote.", content: { "application/json": { schema: errorSchema } } },
            "500": { description: "Storage or document processing failed.", content: { "application/json": { schema: errorSchema } } },
          },
        },
      },
    },
  };
}
