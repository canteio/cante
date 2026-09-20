import { WEBSITE_URL_MAX_LENGTH } from "./onboarding";

const string = { type: "string" } as const;
const json = <T>(schema: T) => ({ "application/json": { schema } });
const error = {
  type: "object",
  properties: { error: string },
  required: ["error"],
} as const;
const profile = {
  type: "object",
  properties: {
    legalName: { type: "string", maxLength: 200 },
    industry: { type: "string", maxLength: 200 },
    products: { type: "array", maxItems: 3, items: { type: "string", minLength: 1, maxLength: 200 } },
    materialsChemicals: { type: "array", maxItems: 3, items: { type: "string", minLength: 1, maxLength: 200 } },
  },
  required: ["legalName", "industry", "products", "materialsChemicals"],
  additionalProperties: false,
} as const;

/** Build discovery without importing customer storage, network fetchers, or model providers. */
export function buildOnboardingWebsiteOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Cante website onboarding API",
      version: "1.0.0",
      description: "Extract editable company-profile suggestions from one public website. Suggestions are not persisted until the customer reviews them.",
    },
    paths: {
      "/api/onboarding/website": {
        post: {
          operationId: "suggestOnboardingProfileFromWebsite",
          summary: "Suggest onboarding profile fields from a public website",
          description: "The service reads at most three redirects and one megabyte of HTML, then makes one bounded model request. Private network addresses are rejected. Website or model failures return a 200 manual-entry fallback so onboarding can continue.",
          requestBody: {
            required: true,
            content: json({
              type: "object",
              properties: {
                url: {
                  type: "string",
                  maxLength: WEBSITE_URL_MAX_LENGTH,
                  description: "Public HTTP or HTTPS website. A missing scheme defaults to HTTPS; credentials and ports other than 80 or 443 are rejected.",
                },
              },
              required: ["url"],
              additionalProperties: false,
            }),
          },
          responses: {
            "200": {
              description: "A profile suggestion, or a manual-entry fallback when the website or model cannot be read.",
              content: json({
                oneOf: [
                  { type: "object", properties: { profile }, required: ["profile"] },
                  { type: "object", properties: { profile: { type: "null" }, note: string }, required: ["profile", "note"] },
                ],
              }),
            },
            "400": { description: "The JSON body or website URL is invalid. The error explains how to correct it.", content: json(error) },
            "403": { description: "The caller has no workspace access.", content: json(error) },
            "500": { description: "Workspace access could not be verified.", content: json(error) },
          },
        },
      },
    },
  };
}
