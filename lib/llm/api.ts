import { zodToJsonSchema } from "@/lib/llm/json-schema";
import {
  LlmError,
  type CompletionRequest,
  type CompletionResult,
  type LlmProvider,
  type StreamEvent,
  type StreamRequest,
} from "@/lib/llm/types";

type HostedProvider = "openai" | "anthropic";

function configuredProvider(): HostedProvider | null {
  const requested = process.env.CANTE_HOSTED_PROVIDER?.trim().toLowerCase();
  if (requested === "openai" || requested === "anthropic") return requested;
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

function promptWithSchema(req: CompletionRequest): string {
  if (!req.schema) return req.prompt;
  return (
    `${req.prompt}\n\n## Output format\n\n` +
    "Reply with JSON only: no prose and no Markdown fence. Validate against this JSON Schema:\n\n" +
    JSON.stringify(zodToJsonSchema(req.schema), null, 2)
  );
}

function requestSignal(req: CompletionRequest): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort(req.signal?.reason);
  req.signal?.addEventListener("abort", abort, { once: true });
  if (req.signal?.aborted) abort();
  const timer = setTimeout(
    () => controller.abort(new Error("Hosted model request timed out")),
    req.timeoutMs ?? 600_000,
  );
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      req.signal?.removeEventListener("abort", abort);
    },
  };
}

async function responseJson(response: Response, provider: HostedProvider): Promise<Record<string, any>> {
  const body = await response.text();
  if (!response.ok) {
    let detail = body.slice(0, 1_000);
    try {
      const parsed = JSON.parse(body);
      detail = parsed?.error?.message ?? parsed?.message ?? detail;
    } catch {
      // Keep the bounded response body. Request headers and keys are never included.
    }
    throw new LlmError(`${provider} API returned ${response.status}: ${detail}`, "api");
  }
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new LlmError(`${provider} API returned invalid JSON`, "api", error);
  }
}

function openAiText(payload: Record<string, any>): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  return (Array.isArray(payload.output) ? payload.output : [])
    .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
    .filter((block: any) => block?.type === "output_text" && typeof block.text === "string")
    .map((block: any) => block.text)
    .join("");
}

async function completeOpenAi(req: CompletionRequest, signal: AbortSignal): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal,
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5",
      instructions: req.system,
      input: promptWithSchema(req),
      // Onboarding extracts supplied text in one call, without web research.
      tools: req.tools?.length === 0 ? [] : [{ type: "web_search" }],
      max_output_tokens: Number(process.env.CANTE_LLM_MAX_OUTPUT_TOKENS || 16_000),
      store: false,
    }),
  });
  const payload = await responseJson(response, "openai");
  const text = openAiText(payload);
  if (!text) throw new LlmError("OpenAI API returned no text output", "api");
  return text;
}

async function completeAnthropic(req: CompletionRequest, signal: AbortSignal): Promise<string> {
  const tools = req.tools?.length === 0 ? [] : [
    { type: "web_search_20250305", name: "web_search", max_uses: 6 },
  ];
  const messages: Array<Record<string, unknown>> = [
    { role: "user", content: promptWithSchema(req) },
  ];

  for (let continuation = 0; continuation < 3; continuation += 1) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal,
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
        max_tokens: Number(process.env.CANTE_LLM_MAX_OUTPUT_TOKENS || 16_000),
        system: req.system,
        messages,
        tools,
      }),
    });
    const payload = await responseJson(response, "anthropic");
    if (payload.stop_reason === "pause_turn") {
      if (req.tools?.length === 0) throw new LlmError("Extraction did not complete", "api");
      messages.push({ role: "assistant", content: payload.content ?? [] });
      continue;
    }
    const text = (Array.isArray(payload.content) ? payload.content : [])
      .filter((block: any) => block?.type === "text" && typeof block.text === "string")
      .map((block: any) => block.text)
      .join("");
    if (!text) throw new LlmError("Anthropic API returned no text output", "api");
    return text;
  }
  throw new LlmError("Anthropic API paused three times without completing", "api");
}

/** Hosted runtime for Vercel. API spend starts only when CANTE_LLM=api is set. */
export class ApiProvider implements LlmProvider {
  readonly name = "api";

  async available() {
    const provider = configuredProvider();
    if (!provider) {
      return {
        ok: false,
        detail: "Set OPENAI_API_KEY or ANTHROPIC_API_KEY for the hosted runtime.",
      };
    }
    const required = provider === "openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
    return required
      ? { ok: true, detail: `${provider} hosted API configured` }
      : { ok: false, detail: `CANTE_HOSTED_PROVIDER=${provider}, but its API key is missing.` };
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const provider = configuredProvider();
    if (!provider) throw new LlmError("No hosted AI API key is configured", this.name);
    const started = Date.now();
    const { signal, cleanup } = requestSignal(req);
    try {
      const text =
        provider === "openai"
          ? await completeOpenAi(req, signal)
          : await completeAnthropic(req, signal);
      return { text, provider: `${this.name}:${provider}`, durationMs: Date.now() - started };
    } catch (error) {
      if (error instanceof LlmError) throw error;
      throw new LlmError(
        `${provider} API call failed: ${error instanceof Error ? error.message : String(error)}`,
        this.name,
        error,
      );
    } finally {
      cleanup();
    }
  }

  async *stream(req: StreamRequest): AsyncIterable<StreamEvent> {
    try {
      const result = await this.complete(req);
      yield { type: "text", text: result.text };
      yield { type: "done" };
    } catch (error) {
      yield { type: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
}
