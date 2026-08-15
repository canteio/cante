import { z, type ZodType } from "zod";

type JsonSchema = Record<string, unknown>;

/**
 * Minimal Zod -> JSON Schema converter.
 *
 * Deliberately small: it covers only the constructs Cante's own schemas use,
 * so the Claude Code provider can show the model the shape it must return
 * without pulling in a conversion library. If a schema here starts needing
 * unions, records, or recursion, swap this for `zod-to-json-schema` rather
 * than growing it — a half-right converter is worse than an honest dependency.
 */
export function zodToJsonSchema(schema: ZodType): JsonSchema {
  return convert(schema);
}

function convert(schema: ZodType): JsonSchema {
  const description = schema.description;
  const base = convertInner(schema);
  return description ? { ...base, description } : base;
}

function convertInner(schema: ZodType): JsonSchema {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    return convert(schema._def.innerType);
  }
  if (schema instanceof z.ZodNullable) {
    const inner = convert(schema._def.innerType);
    const type = inner.type;
    return { ...inner, type: Array.isArray(type) ? [...type, "null"] : [type, "null"] };
  }
  if (schema instanceof z.ZodString) return { type: "string" };
  if (schema instanceof z.ZodNumber) return { type: "number" };
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodLiteral) return { const: schema._def.value };
  if (schema instanceof z.ZodEnum) return { type: "string", enum: schema._def.values };
  if (schema instanceof z.ZodArray) {
    return { type: "array", items: convert(schema._def.type) };
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, ZodType>;
    const properties: JsonSchema = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = convert(value);
      const optional = value instanceof z.ZodOptional || value instanceof z.ZodDefault;
      if (!optional) required.push(key);
    }
    return { type: "object", properties, required, additionalProperties: false };
  }
  // Unknown construct — say so rather than silently emitting `{}`, which the
  // model would read as "anything goes".
  throw new Error(`zodToJsonSchema: unsupported schema type ${schema.constructor.name}`);
}
