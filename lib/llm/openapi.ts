import { PROVIDER_OPTIONS } from "./provider-choice";

const string = { type: "string" } as const;
const json = <T>(schema: T) => ({ "application/json": { schema } });
const providerIds = PROVIDER_OPTIONS.map(({ id }) => id);

const health = {
  type: "object",
  properties: { ok: { type: "boolean" }, detail: string },
  required: ["ok", "detail"],
} as const;

const provider = {
  type: "object",
  properties: {
    id: { type: "string", enum: providerIds },
    label: string,
    shortLabel: string,
    description: string,
    selected: { type: "boolean" },
    ok: { type: "boolean" },
    detail: string,
  },
  required: ["id", "label", "shortLabel", "description", "selected", "ok", "detail"],
} as const;

const error = {
  type: "object",
  properties: { error: string },
  required: ["error"],
} as const;

/** Build discovery without importing provider implementations or probing their executables. */
export function buildLlmOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Cante language-model provider API",
      version: "1.0.0",
      description: "Inspect available model providers and select the provider used by this browser session.",
    },
    paths: {
      "/api/llm": {
        get: {
          operationId: "listLanguageModelProviders",
          summary: "List provider availability and the current selection",
          responses: {
            "200": {
              description: "Provider health is probed at request time. When server configuration locks the selection, providers contains only that provider and locked is true.",
              content: json({
                type: "object",
                properties: {
                  selected: { type: "string", enum: providerIds },
                  locked: { type: "boolean" },
                  providers: { type: "array", items: provider },
                },
                required: ["selected", "providers"],
              }),
            },
            "500": { description: "A provider availability probe failed unexpectedly.", content: json(error) },
          },
        },
        post: {
          operationId: "selectLanguageModelProvider",
          summary: "Select a healthy provider for this browser session",
          description: "The choice is stored in a same-site cookie for one year. Common aliases such as codex, chatgpt, gemini, and agy are normalized; an omitted or unknown value falls back to claude-code.",
          requestBody: {
            required: true,
            content: json({
              type: "object",
              properties: {
                provider: {
                  type: "string",
                  enum: providerIds,
                  description: "Canonical provider ID. Use GET /api/llm to inspect current availability before selecting.",
                },
              },
              additionalProperties: false,
            }),
          },
          responses: {
            "200": {
              description: "The selected provider is healthy and the preference cookie was set.",
              content: json({
                type: "object",
                properties: {
                  selected: { type: "string", enum: providerIds },
                  provider: {
                    type: "object",
                    properties: {
                      id: { type: "string", enum: providerIds },
                      label: string,
                      shortLabel: string,
                      description: string,
                    },
                    required: ["id", "label", "shortLabel", "description"],
                  },
                  health,
                },
                required: ["selected", "provider", "health"],
              }),
            },
            "400": { description: "The request body is not a JSON object.", content: json(error) },
            "409": {
              description: "Selection is locked by server configuration, or the requested provider is unavailable.",
              content: json({ oneOf: [error, {
                type: "object",
                properties: {
                  selected: { type: "string", enum: providerIds },
                  health,
                },
                required: ["selected", "health"],
              }] }),
            },
            "500": { description: "Provider probing or cookie persistence failed unexpectedly.", content: json(error) },
          },
        },
      },
    },
  };
}
