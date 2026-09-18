import { SCREENING_LIMITS } from "./csl";

/**
 * Storage-free contract for /api/screening. Discovery must stay available when
 * tenant storage is down because this endpoint only reads Trade.gov's CSL.
 */

const noStoreHeader = {
  description: "Screening responses are private and must not be cached.",
  schema: { type: "string", const: "no-store, max-age=0" },
} as const;

const errorSchema = {
  type: "object",
  properties: { error: { type: "string" } },
  required: ["error"],
  additionalProperties: false,
} as const;

const addressSchema = {
  type: "object",
  properties: {
    address: { type: ["string", "null"] },
    city: { type: ["string", "null"] },
    state: { type: ["string", "null"] },
    postalCode: { type: ["string", "null"] },
    country: { type: ["string", "null"] },
  },
  required: ["address", "city", "state", "postalCode", "country"],
} as const;

const matchSchema = {
  type: "object",
  properties: {
    queriedName: { type: "string" },
    matchedName: { type: "string" },
    matchField: { type: "string", enum: ["primary", "alias"] },
    primaryName: { type: "string" },
    sourceList: { type: "string" },
    sourceUrl: { type: "string", format: "uri" },
    addresses: {
      type: "array",
      maxItems: SCREENING_LIMITS.maxAddressesPerMatch,
      items: addressSchema,
    },
    addressesTruncated: { type: "boolean" },
    countries: { type: "array", items: { type: "string" }, uniqueItems: true },
  },
  required: [
    "queriedName",
    "matchedName",
    "matchField",
    "primaryName",
    "sourceList",
    "sourceUrl",
    "addresses",
    "addressesTruncated",
    "countries",
  ],
} as const;

export function buildScreeningOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Cante Restricted-Party Screening API",
      version: "1.0.0",
      description:
        "Exact normalized-name matching against the U.S. Trade.gov Consolidated Screening List. A no-hit result is not clearance; every potential match requires human review against the originating list.",
    },
    paths: {
      "/api/screening": {
        post: {
          summary: "Screen up to 25 party names using exact normalized primary-name and alias matching.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    names: {
                      type: "array",
                      minItems: 1,
                      maxItems: SCREENING_LIMITS.maxNames,
                      items: {
                        type: "string",
                        minLength: 1,
                        maxLength: SCREENING_LIMITS.maxNameLength,
                      },
                      description: `Names are trimmed and deduplicated after normalization. Their combined pre-normalized length must not exceed ${SCREENING_LIMITS.maxTotalNameLength} characters.`,
                    },
                  },
                  required: ["names"],
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "200": {
              description: "The bounded match set plus explicit no-hit and human-review caveats.",
              headers: { "Cache-Control": noStoreHeader },
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      source: { type: "string", const: "Trade.gov Consolidated Screening List" },
                      sourceUrl: { type: "string", format: "uri" },
                      matchMethod: { type: "string", const: "exact-normalized-name" },
                      screenedNames: { type: "array", items: { type: "string" } },
                      unmatchedNames: { type: "array", items: { type: "string" } },
                      matches: {
                        type: "array",
                        maxItems: SCREENING_LIMITS.maxMatches,
                        items: matchSchema,
                      },
                      matchesTruncated: { type: "boolean" },
                      fetchedAt: { type: "string", format: "date-time" },
                      caveats: { type: "array", items: { type: "string" } },
                    },
                    required: [
                      "source",
                      "sourceUrl",
                      "matchMethod",
                      "screenedNames",
                      "unmatchedNames",
                      "matches",
                      "matchesTruncated",
                      "fetchedAt",
                      "caveats",
                    ],
                  },
                },
              },
            },
            "400": {
              description: "Malformed JSON or an invalid names array. Validation occurs before Trade.gov is fetched.",
              headers: { "Cache-Control": noStoreHeader },
              content: { "application/json": { schema: errorSchema } },
            },
            "502": {
              description: "Trade.gov could not be fetched safely or returned malformed/oversized data.",
              headers: { "Cache-Control": noStoreHeader },
              content: { "application/json": { schema: errorSchema } },
            },
            "500": {
              description: "Unexpected screening failure.",
              headers: { "Cache-Control": noStoreHeader },
              content: { "application/json": { schema: errorSchema } },
            },
          },
        },
      },
    },
  };
}
