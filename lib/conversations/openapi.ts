import { DEFAULT_JURISDICTION, SUPPORTED_JURISDICTIONS } from "@/lib/countries";

const string = { type: "string" } as const;
const error = {
  type: "object",
  properties: { error: string },
  required: ["error"],
} as const;
const json = <T>(schema: T) => ({ "application/json": { schema } });

const activity = {
  type: "object",
  properties: {
    id: string,
    name: string,
    detail: string,
    url: string,
    hostname: string,
    results: {
      type: "array",
      items: {
        type: "object",
        properties: { title: string, url: string, hostname: string },
        required: ["title", "url", "hostname"],
      },
    },
  },
  required: ["name", "detail"],
} as const;

const conversation = {
  type: "object",
  properties: {
    id: string,
    customerId: string,
    jurisdiction: { type: "string", enum: SUPPORTED_JURISDICTIONS.map(({ name }) => name) },
    title: string,
    createdAt: string,
    updatedAt: string,
  },
  required: ["id", "customerId", "jurisdiction", "title", "createdAt", "updatedAt"],
} as const;

const message = {
  type: "object",
  properties: {
    id: string,
    conversationId: string,
    // The writer currently creates these two roles, but old imported rows are not revalidated on read.
    role: { type: "string", description: "New messages use user or agent; legacy stored rows may contain another value." },
    content: string,
    activity: { type: "array", items: activity },
    createdAt: string,
  },
  required: ["id", "conversationId", "role", "content", "activity", "createdAt"],
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

/** Build discovery without importing the database client or authentication session. */
export function buildConversationsOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Cante conversations API",
      version: "1.0.0",
      description: "List, read, and delete saved compliance chat conversations. Use the deployment's normal authentication; middleware can reject unauthenticated requests.",
    },
    paths: {
      "/api/conversations": {
        get: {
          operationId: "getConversations",
          summary: "List conversations or read one conversation with its messages",
          description: "When id is present it takes precedence over customerId and country. Without id, an unresolved customer returns {conversations: []} and omits jurisdiction.",
          parameters: [
            { name: "id", in: "query", required: false, schema: string, description: "Conversation ID. Returns the conversation and its messages." },
            { name: "customerId", in: "query", required: false, schema: customerId },
            { name: "country", in: "query", required: false, schema: country },
          ],
          responses: {
            "200": {
              description: "A detail object when id is supplied, otherwise a filtered list.",
              content: json({
                oneOf: [
                  {
                    type: "object",
                    properties: { conversation, messages: { type: "array", items: message } },
                    required: ["conversation", "messages"],
                  },
                  {
                    type: "object",
                    properties: {
                      jurisdiction: { type: "string", enum: SUPPORTED_JURISDICTIONS.map(({ name }) => name) },
                      conversations: { type: "array", items: conversation },
                    },
                    // An unresolved customer deliberately omits jurisdiction.
                    required: ["conversations"],
                  },
                ],
              }),
            },
            "404": { description: "The requested conversation ID does not exist.", content: json(error) },
            "500": { description: "Storage or authentication lookup failed.", content: json(error) },
          },
        },
        delete: {
          operationId: "deleteConversation",
          summary: "Delete a conversation and its messages",
          description: "Deletion is idempotent: an unknown id still returns ok:true.",
          parameters: [
            { name: "id", in: "query", required: true, schema: string, description: "Conversation ID to delete." },
          ],
          responses: {
            "200": { description: "Deletion executed, including when the ID was already absent.", content: json({ type: "object", properties: { ok: { const: true } }, required: ["ok"] }) },
            "400": { description: "The id query parameter is missing.", content: json(error) },
            "500": { description: "Storage deletion failed.", content: json(error) },
          },
        },
      },
    },
  };
}
