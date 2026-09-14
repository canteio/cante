import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { zodToJsonSchema } from "./json-schema";

test("zodToJsonSchema converts primitives", () => {
  assert.deepEqual(zodToJsonSchema(z.string()), { type: "string" });
  assert.deepEqual(zodToJsonSchema(z.number()), { type: "number" });
  assert.deepEqual(zodToJsonSchema(z.boolean()), { type: "boolean" });
  assert.deepEqual(zodToJsonSchema(z.literal("HS")), { const: "HS" });
  assert.deepEqual(zodToJsonSchema(z.enum(["A", "B"])), {
    type: "string",
    enum: ["A", "B"],
  });
});

test("zodToJsonSchema preserves descriptions", () => {
  const schema = z.string().describe("an HS code");
  assert.deepEqual(zodToJsonSchema(schema), {
    type: "string",
    description: "an HS code",
  });
});

test("zodToJsonSchema unwraps optional, default, and nullable", () => {
  assert.deepEqual(zodToJsonSchema(z.string().optional()), { type: "string" });
  assert.deepEqual(zodToJsonSchema(z.number().default(0)), { type: "number" });
  assert.deepEqual(zodToJsonSchema(z.string().nullable()), {
    type: ["string", "null"],
  });
});

test("zodToJsonSchema converts arrays", () => {
  assert.deepEqual(zodToJsonSchema(z.array(z.string())), {
    type: "array",
    items: { type: "string" },
  });
});

test("zodToJsonSchema converts objects and tracks required vs optional keys", () => {
  const schema = z.object({
    hsCode: z.string(),
    quantity: z.number().optional(),
    unit: z.string().default("MT"),
  });

  assert.deepEqual(zodToJsonSchema(schema), {
    type: "object",
    properties: {
      hsCode: { type: "string" },
      quantity: { type: "number" },
      unit: { type: "string" },
    },
    required: ["hsCode"],
    additionalProperties: false,
  });
});

test("zodToJsonSchema converts nested objects and arrays of objects", () => {
  const schema = z.object({
    items: z.array(
      z.object({
        sku: z.string(),
        weightKg: z.number().nullable(),
      })
    ),
  });

  assert.deepEqual(zodToJsonSchema(schema), {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            sku: { type: "string" },
            weightKg: { type: ["number", "null"] },
          },
          required: ["sku", "weightKg"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  });
});

test("zodToJsonSchema throws a clear error for unsupported constructs", () => {
  assert.throws(
    () => zodToJsonSchema(z.union([z.string(), z.number()]) as unknown as z.ZodType),
    /unsupported schema type/
  );
});
