import {
  EXTRACTED_FILE_FORMATS,
  MAX_EXTRACTED_FILE_BYTES,
  MAX_EXTRACTED_TEXT_CHARS,
} from "./files-extract-contract";

const errorSchema = {
  type: "object",
  properties: { error: { type: "string" } },
  required: ["error"],
} as const;

/** Build discovery without importing file parsers, customer storage, or network clients. */
export function buildFilesExtractOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Cante chat file extraction API",
      version: "1.1.0",
      description:
        "Extract text from one uploaded trade document for use in chat. This extraction endpoint is read-only. The chunked chat-upload API saves immutable originals first. Product-table checks require explicit customs facts. OCR is not supported.",
    },
    paths: {
      "/api/files/uploads": {post:{summary:"Reserve a private immutable workspace original (up to 15 MiB).",requestBody:{required:true,content:{"application/json":{schema:{type:"object",properties:{filename:{type:"string"},size:{type:"integer",minimum:1,maximum:MAX_EXTRACTED_FILE_BYTES},sha256:{type:"string",pattern:"^[0-9a-f]{64}$"}},required:["filename","size","sha256"]}}}},responses:{"201":{description:"Upload UUID and chunkBytes (1 MiB)."},"400":{description:"Invalid file metadata."},"401":{description:"Authentication required."},"403":{description:"Write access required."},"429":{description:"Upload admission quota reached."},"503":{description:"Storage/request budget unavailable or exceeded."}}}},
      "/api/files/uploads/{id}": {parameters:[{name:"id",in:"path",required:true,schema:{type:"string",format:"uuid"}}],put:{summary:"Save one immutable chunk in an upload owned by the caller.",parameters:[{name:"part",in:"query",required:true,schema:{type:"integer",minimum:0,maximum:14}}],requestBody:{required:true,content:{"application/octet-stream":{schema:{type:"string",format:"binary"}}}},responses:{"200":{description:"Chunk saved. Exact expected byte length required."},"400":{description:"Invalid index/length."},"404":{description:"Upload not found or not owned by caller."},"409":{description:"Chunk cannot be overwritten."},"413":{description:"Chunk exceeds 1 MiB."},"429":{description:"Chunk admission quota reached."}}},get:{summary:"Download a checksum-verified workspace original as a byte stream.",responses:{"200":{description:"Private, no-store original download."},"404":{description:"Original unavailable or checksum failed."},"429":{description:"Download quota reached."}}}},
      "/api/files/extract": {
        post: {
          summary: "Extract prompt-ready text from one uploaded file.",
          description:
            `Accepts PDF files with a text layer, XLSX/XLSM, DOCX, CSV, TXT, Markdown, and .text files up to ${MAX_EXTRACTED_FILE_BYTES / 1024 / 1024}MB. ` +
            `The text preview includes at most ${MAX_EXTRACTED_TEXT_CHARS.toLocaleString("en-US")} characters and reports truncation in warnings. New chat uploads use /api/files/uploads, PUT chunks up to 1 MiB, then send {uploadId} here. Originals support 15 MiB; only a bounded preview and table metadata are returned. Legacy multipart CSV uploads return originalCsv separately.`,
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { type: "object", properties: { uploadId: {type:"string",format:"uuid"} }, required:["uploadId"], additionalProperties:false } },
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    file: {
                      type: "string",
                      format: "binary",
                      description: "The file to read. Scans, password-protected files, .xls, and .doc files are rejected with a corrective error.",
                    },
                  },
                  required: ["file"],
                },
              },
            },
          },
          responses: {
            "401": { description: "Authentication and workspace access required.", content: { "application/json": { schema: errorSchema } } },
            "429": { description: "Account/workspace request or concurrency budget reached.", headers: { "Retry-After": { schema: { type: "integer", minimum: 1 } } }, content: { "application/json": { schema: errorSchema } } },
            "503": { description: "Request limits are unavailable; no operation was run.", content: { "application/json": { schema: errorSchema } } },
            "200": {
              description: "Extracted text plus any completeness warnings.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      uploadId: {type:"string",format:"uuid",description:"Immutable workspace original reference for new chunked uploads."},
                      tables: {type:"array",description:"Detected table headers, up to five preview rows, mapping suggestions, and whether review is required. Full rows stay server-side.",items:{type:"object"}},
                      filename: { type: "string" },
                      format: { type: "string", enum: EXTRACTED_FILE_FORMATS },
                      text: { type: "string", maxLength: MAX_EXTRACTED_TEXT_CHARS },
                      originalCsv: { type: "string", description: "Complete UTF-8 CSV, preserving BOM and line endings. Present only for CSV uploads up to 15 MiB (legacy multipart path). New chat uploads use a saved uploadId." },
                      warnings: { type: "array", items: { type: "string" } },
                    },
                    required: ["filename", "format", "text", "warnings"],
                  },
                },
              },
            },
            "400": {
              description: "The request is not multipart, has no file, cannot be parsed, exceeds the size limit, or uses unreadable or unsupported content.",
              content: { "application/json": { schema: errorSchema } },
            },
            "500": {
              description: "An unexpected extraction failure occurred.",
              content: { "application/json": { schema: errorSchema } },
            },
            "413": {
              description: "The file exceeds 15 MiB, or the incoming multipart body exceeds 15 MiB plus 64 KiB framing overhead.",
              content: { "application/json": { schema: errorSchema } },
            },
          },
        },
      },
    },
  };
}
