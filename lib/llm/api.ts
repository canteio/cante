import { zodToJsonSchema } from "@/lib/llm/json-schema";
import {
  LlmError,
  type CompletionRequest,
  type CompletionResult,
  type LlmProvider,
  type StreamEvent,
  type StreamRequest,
  type SearchResult,
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

async function requestOpenAi(req: CompletionRequest, signal: AbortSignal, stream = false): Promise<Response> {
  // MVP: a prior change tried the Chat Completions endpoint first and fell
  // back to Responses on failure. That silently doubled every hosted OpenAI
  // call (a real cost regression rule 1 exists to prevent) and broke the
  // "no tools, exactly one request" contract lib/llm/api.test.ts pins.
  // Chat Completions also doesn't support the web_search tool below, so
  // which endpoint happened to answer would change what the model could do.
  // Reverted to the single, audited Responses call.
  const model = process.env.OPENAI_MODEL || "gpt-4o";
  const userPrompt = promptWithSchema(req);
  const inputContent: Array<Record<string, unknown>> = [{ type: "input_text", text: userPrompt }];
  for (const image of req.images ?? []) {
    inputContent.push({ type: "input_image", image_url: `data:${image.mimeType};base64,${image.base64}` });
  }
  return fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal,
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: req.system,
      input: req.images?.length ? [{ role: "user", content: inputContent }] : userPrompt,
      tools: req.tools?.length === 0 ? [] : [{ type: "web_search" }],
      max_output_tokens: Number(process.env.CANTE_LLM_MAX_OUTPUT_TOKENS || 4_000),
      store: false,
      // Opt in only for the supported GPT-5 family; leave extraction and older models unchanged.
      ...(stream && (req as StreamRequest).reasoningSummary && /^gpt-5(?:[.-]|$)/.test(model)
        ? { reasoning: { summary: "auto" } } : {}),
      ...(stream ? { stream: true, include: req.tools?.length === 0 ? [] : ["web_search_call.action.sources"] } : {}),
    }),
  });
}

async function completeOpenAi(req: CompletionRequest, signal: AbortSignal): Promise<string> {
  const response = await requestOpenAi(req, signal);
  const payload = await responseJson(response, "openai");
  const text = openAiText(payload);
  if (!text) throw new LlmError("OpenAI API returned no text output", "api");
  return text;
}

/** Decode actual SSE frames, including split UTF-8/chunks and multiline data. */
async function* openAiEvents(response: Response): AsyncIterable<Record<string, any>> {
  if (!response.ok) { await responseJson(response, "openai"); return; }
  if (!response.body) throw new LlmError("OpenAI returned no event stream", "api");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (done) buffer += "\n\n";
      let boundary: number;
      while ((boundary = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, boundary).replace(/\r$/, "");
        buffer = buffer.slice(boundary + 1);
        if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        else if (line === "" && data.length) {
          const payload = data.join("\n");
          data = [];
          if (payload !== "[DONE]") yield JSON.parse(payload);
        }
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Only URLs actually returned by the provider become source badges. */
function searchSources(item: Record<string, any>): SearchResult[] {
  const raw = [...(item.action?.sources ?? []), ...(item.content ?? []).flatMap((c: any) => c.annotations ?? [])];
  if (item.action?.url) raw.push({ url: item.action.url });
  const results = new Map<string, SearchResult>();
  for (const source of raw) {
    try {
      const url = new URL(source.url);
      if (!["https:", "http:"].includes(url.protocol)) continue;
      results.set(url.href, { url: url.href, title: source.title || url.hostname, hostname: url.hostname });
    } catch { /* Missing/invalid source URLs are not links. */ }
  }
  return [...results.values()];
}

function searchEnd(item: Record<string, any>): StreamEvent {
  const action = item.action;
  const detail = action?.query || action?.queries?.join(" · ");
  const results = searchSources(item);
  if (action?.type === "open_page" || action?.type === "find_in_page") {
    const page = results.find(r => r.url === action.url);
    return { type: "tool_end", id: item.id, results, name: "WebFetch", detail: page?.hostname || "source page", ...(page ? { url: page.url, hostname: page.hostname } : {}) };
  }
  return { type: "tool_end", id: item.id, results, ...(detail ? { detail } : {}) };
}

async function* streamOpenAi(req: StreamRequest, signal: AbortSignal): AsyncIterable<StreamEvent> {
  const response = await requestOpenAi(req, signal, true);
  const started = new Set<string>();
  const finished = new Set<string>();
  let thinking = false;
  let completed = false;
  let hasText = false;
  for await (const event of openAiEvents(response)) {
    if (event.type === "response.created") {
      thinking = true;
      yield { type: "thinking_start" };
    }
    const item = event.item;
    const id = item?.id ?? event.item_id;
    if ((item?.type === "web_search_call" || event.type === "response.web_search_call.in_progress") && id && !started.has(id)) {
      if (thinking) { yield { type: "thinking_end" }; thinking = false; }
      started.add(id);
      yield { type: "tool_start", id, name: "WebSearch", detail: "the web" };
    }
    if (event.type === "response.output_item.done" && item?.type === "web_search_call") {
      finished.add(id);
      yield searchEnd(item);
    }
    if (["response.reasoning_summary_text.delta", "response.reasoning_summary_text.done"].includes(event.type)) {
      if (thinking) { yield { type: "thinking_end" }; thinking = false; }
      const done = event.type.endsWith(".done");
      const text = done ? event.text : event.delta;
      if (typeof text === "string" && typeof event.item_id === "string") {
        yield { type: "reasoning_summary", id: `summary-${event.item_id}-${event.summary_index ?? 0}`, text, done };
      }
    }
    if (event.type === "response.output_text.delta") {
      if (thinking) { yield { type: "thinking_end" }; thinking = false; }
      if (typeof event.delta === "string" && event.delta) {
        hasText = true;
        yield { type: "text", text: event.delta };
      }
    }
    if (event.type === "response.completed") {
      // The final response can contain richer source metadata than item events.
      for (const output of event.response?.output ?? []) {
        if (output.type === "web_search_call") {
          finished.add(output.id);
          yield searchEnd(output);
        }
      }
      if (!hasText) throw new LlmError("OpenAI API returned no text output", "api");
      completed = true;
      break;
    }
    if (["error", "response.failed", "response.incomplete"].includes(event.type)) {
      throw new LlmError(event.message || event.response?.error?.message || "OpenAI response did not complete", "api");
    }
  }
  if (!completed) throw new LlmError("OpenAI stream ended before completion", "api");
  if (thinking) yield { type: "thinking_end" };
  for (const id of started) if (!finished.has(id)) throw new LlmError("OpenAI search did not complete", "api");
  yield { type: "done" };
}

async function completeAnthropic(req: CompletionRequest, signal: AbortSignal): Promise<string> {
  const tools = req.tools?.length === 0 ? [] : [
    { type: "web_search_20250305", name: "web_search", max_uses: 6 },
  ];
  const userContent: Array<Record<string, unknown>> = [];
  for (const image of req.images ?? []) {
    userContent.push({
      type: "image",
      source: { type: "base64", media_type: image.mimeType, data: image.base64 },
    });
  }
  userContent.push({ type: "text", text: promptWithSchema(req) });
  const messages: Array<Record<string, unknown>> = [
    { role: "user", content: req.images?.length ? userContent : promptWithSchema(req) },
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
      if (configuredProvider() === "openai") {
        const { signal, cleanup } = requestSignal(req);
        try { yield* streamOpenAi(req, signal); }
        finally { cleanup(); }
      } else {
        const result = await this.complete(req);
        yield { type: "text", text: result.text };
        yield { type: "done" };
      }
    } catch (error) {
      yield { type: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
}
