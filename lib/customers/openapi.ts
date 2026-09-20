import { PROVIDER_OPTIONS } from "@/lib/llm/provider-choice";

const string = { type: "string" } as const;
const nullableString = { type: ["string", "null"] } as const;
const json = <T>(schema: T) => ({ "application/json": { schema } });

const customer = {
  type: "object",
  properties: {
    id: string,
    name: string,
    country: string,
    city: nullableString,
    createdAt: { type: "string", format: "date-time" },
  },
  required: ["id", "name", "country", "city", "createdAt"],
} as const;

const source = {
  type: "object",
  properties: {
    id: string,
    country: string,
    name: string,
    domain: string,
    url: { type: "string", format: "uri" },
    regulationType: string,
    reliabilityStatus: string,
    view: nullableString,
    notes: nullableString,
    lastSuccessAt: { type: ["string", "null"], format: "date-time" },
  },
  required: [
    "id", "country", "name", "domain", "url", "regulationType",
    "reliabilityStatus", "view", "notes", "lastSuccessAt",
  ],
} as const;

/** Build customer discovery without opening storage or probing a local model CLI. */
export function buildCustomersOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Cante customer workspace API",
      version: "1.0.0",
      description: "List customer workspaces, configured regulatory sources, and the active language-model provider's availability.",
    },
    paths: {
      "/api/customers": {
        get: {
          operationId: "listCustomerWorkspaces",
          summary: "List workspaces, sources, and active model health",
          description: "This read also probes the selected model provider. A provider can report ok:false while the customer and source lists still return successfully.",
          responses: {
            "200": {
              description: "Customer and source rows are ordered by name. The llm object reports availability rather than guaranteeing a model request will succeed.",
              content: json({
                type: "object",
                properties: {
                  customers: { type: "array", items: customer },
                  sources: { type: "array", items: source },
                  llm: {
                    type: "object",
                    properties: {
                      provider: { type: "string", enum: PROVIDER_OPTIONS.map(({ id }) => id) },
                      ok: { type: "boolean" },
                      detail: string,
                    },
                    required: ["provider", "ok", "detail"],
                  },
                },
                required: ["customers", "sources", "llm"],
              }),
            },
            "500": {
              description: "Customer storage, source storage, or the provider availability probe failed.",
              content: json({
                type: "object",
                properties: { error: string },
                required: ["error"],
              }),
            },
          },
        },
      },
    },
  };
}
