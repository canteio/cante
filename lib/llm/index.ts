import { ApiProvider } from "@/lib/llm/api";
import { ClaudeCodeProvider } from "@/lib/llm/claude-code";
import { CodexCliProvider } from "@/lib/llm/codex-cli";
import {
  normalizeProviderChoice,
  PROVIDER_COOKIE,
  PROVIDER_OPTIONS,
  type LlmProviderChoice,
} from "@/lib/llm/provider-choice";
import { LlmError, type LlmProvider } from "@/lib/llm/types";
import type { ZodType, z } from "zod";

export type { LlmProvider, CompletionRequest, CompletionResult } from "@/lib/llm/types";
export { LlmError } from "@/lib/llm/types";
export { PROVIDER_COOKIE, PROVIDER_OPTIONS, normalizeProviderChoice };
export type { LlmProviderChoice };

/**
 * Defaults to the local CLI. Nothing reaches the paid API unless someone
 * deliberately sets CANTE_LLM=api — an unset variable never starts spending.
 */
export function getProvider(choice?: string | null): LlmProvider {
  const selected = normalizeProviderChoice(choice ?? process.env.CANTE_LLM);
  switch (selected) {
    case "claude-code":
      return new ClaudeCodeProvider();
    case "codex-cli":
      return new CodexCliProvider();
    case "api":
      return new ApiProvider();
    default:
      throw new LlmError(`Unknown CANTE_LLM value: ${selected}`, "factory");
  }
}

/**
 * Ask for JSON and validate it here, above the seam, so both providers are
 * held to the same shape. Tolerates a model that wraps its JSON in a code
 * fence or adds a sentence around it — but not one that returns the wrong
 * shape, which throws.
 */
export async function completeJson<T extends ZodType>(
  provider: LlmProvider,
  schema: T,
  req: { system: string; prompt: string; timeoutMs?: number },
): Promise<{ value: z.infer<T>; raw: string; durationMs: number }> {
  const result = await provider.complete({ ...req, schema });
  const json = extractJson(result.text);

  if (json === null) {
    throw new LlmError(
      `${provider.name} returned no JSON object. First 500 chars:\n${result.text.slice(0, 500)}`,
      provider.name,
    );
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new LlmError(
      `${provider.name} returned JSON that does not match the schema: ${parsed.error.message}`,
      provider.name,
    );
  }

  return { value: parsed.data, raw: result.text, durationMs: result.durationMs };
}

/** Pull the first balanced JSON object out of a model response. */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      // Fall through to brace-scanning: the model may have wrapped the object
      // in prose despite being told not to.
    }
    const start = trimmed.indexOf("{");
    if (start === -1) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = !inString;
      if (inString) continue;
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(trimmed.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}
