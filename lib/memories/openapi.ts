import { DEFAULT_JURISDICTION, SUPPORTED_JURISDICTIONS } from "@/lib/countries";
import { MEMORY_KINDS } from "./contract";

const string = { type: "string" } as const;
const error = {
  type: "object",
  properties: { error: string },
  required: ["error"],
} as const;
const json = <T>(schema: T) => ({ "application/json": { schema } });

const memory = {
  type: "object",
  properties: {
    id: string,
    customerId: string,
    jurisdiction: { type: "string", enum: SUPPORTED_JURISDICTIONS.map(({ name }) => name) },
    kind: { type: "string", enum: MEMORY_KINDS },
    content: string,
    source: { type: ["string", "null"] },
    origin: { type: "string", description: "Usually manual, chat, or run; legacy rows are not revalidated on read." },
    confirmed: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
  },
  required: ["id", "customerId", "jurisdiction", "kind", "content", "source", "origin", "confirmed", "createdAt"],
} as const;

const customerId = {
  type: "string",
  description: "Optional workspace selector. Supabase auth restricts this to the authenticated workspace; otherwise omission selects the default local customer.",
} as const;
const country = {
  type: "string",
  default: DEFAULT_JURISDICTION,
  description: "US/USA/ID aliases are accepted; missing or unrecognized values default to United States.",
} as const;

/** Build discovery without importing storage or checklist regeneration. */
export function buildMemoriesOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Cante compliance memory API",
      version: "1.0.0",
      description: "List, add, confirm, unconfirm, and delete facts used by the compliance checklist. Manually entered facts are confirmed; chat-proposed facts require human confirmation.",
    },
    paths: {
      "/api/memories": {
        get: {
          operationId: "listMemories",
          summary: "List compliance memories for a workspace and jurisdiction",
          parameters: [
            { name: "customerId", in: "query", required: false, schema: customerId },
            { name: "country", in: "query", required: false, schema: country },
          ],
          responses: {
            "200": { description: "Confirmed memories first, then newest first. An unresolved customer returns an empty list without jurisdiction.", content: json({ type: "object", properties: { jurisdiction: { type: "string" }, memories: { type: "array", items: memory } }, required: ["memories"] }) },
          },
        },
        post: {
          operationId: "createMemory",
          summary: "Add a human-confirmed compliance memory",
          requestBody: { required: true, content: { "application/json": { schema: {
            type: "object",
            properties: { customerId, country, kind: { type: "string", enum: MEMORY_KINDS, default: "other" }, content: string, source: { type: "string", default: "entered by hand" } },
            required: ["content"],
          } } } },
          responses: {
            "200": { description: "The stored, confirmed memory.", content: json({ type: "object", properties: { memory }, required: ["memory"] }) },
            "400": { description: "The body is not a JSON object or content is blank.", content: json(error) },
            "404": { description: "No customer could be resolved.", content: json(error) },
            "409": { description: "The same content is already remembered for this workspace and jurisdiction.", content: json(error) },
          },
        },
        patch: {
          operationId: "setMemoryConfirmation",
          summary: "Confirm or unconfirm a memory",
          description: "Unknown IDs are idempotent and still return ok:true.",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { id: string, confirmed: { type: "boolean" } }, required: ["id", "confirmed"] } } } },
          responses: {
            "200": { description: "Confirmation state was applied.", content: json({ type: "object", properties: { ok: { const: true } }, required: ["ok"] }) },
            "400": { description: "The body is not a JSON object or id is missing.", content: json(error) },
            "500": { description: "Storage or checklist refresh failed.", content: json(error) },
          },
        },
        delete: {
          operationId: "deleteMemory",
          summary: "Delete a memory",
          description: "Deletion is idempotent: an unknown ID still returns ok:true.",
          parameters: [{ name: "id", in: "query", required: true, schema: string }],
          responses: {
            "200": { description: "Deletion was applied.", content: json({ type: "object", properties: { ok: { const: true } }, required: ["ok"] }) },
            "400": { description: "The id query parameter is missing.", content: json(error) },
            "500": { description: "Storage or checklist refresh failed.", content: json(error) },
          },
        },
      },
    },
  };
}
