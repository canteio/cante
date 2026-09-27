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
      version: "1.0.0",
      description:
        "Extract text from one uploaded trade document for use in chat. This endpoint does not store the file or add it to the compliance record. OCR is not supported.",
    },
    paths: {
      "/api/files/extract": {
        post: {
          summary: "Extract prompt-ready text from one uploaded file.",
          description:
            `Accepts PDF files with a text layer, XLSX/XLSM, DOCX, CSV, TXT, Markdown, and .text files up to ${MAX_EXTRACTED_FILE_BYTES / 1024 / 1024}MB. ` +
            `The response includes at most ${MAX_EXTRACTED_TEXT_CHARS.toLocaleString("en-US")} characters and reports truncation in warnings.`,
          requestBody: {
            required: true,
            content: {
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
            "200": {
              description: "Extracted text plus any completeness warnings.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      filename: { type: "string" },
                      format: { type: "string", enum: EXTRACTED_FILE_FORMATS },
                      text: { type: "string", maxLength: MAX_EXTRACTED_TEXT_CHARS },
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
          },
        },
      },
    },
  };
}
