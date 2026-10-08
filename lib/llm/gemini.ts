import { zodToJsonSchema } from "@/lib/llm/json-schema";
import {
  LlmError,
  type CompletionRequest,
  type CompletionResult,
  type LlmProvider,
  type SearchResult,
  type StreamEvent,
  type StreamRequest,
} from "@/lib/llm/types";

/**
 * Google Gemini / Antigravity Provider for Cante Compliance OS.
 * Supports Gemini 2.5 Flash and Pro with native Google Search grounding,
 * structured JSON schemas, and streaming SSE output.
 */
export class GeminiProvider implements LlmProvider {
  readonly name = "gemini";

  constructor(
    private readonly apiKey = process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GOOGLE_GENAI_API_KEY ||
      "",
    private readonly model = process.env.GEMINI_MODEL || "gemini-2.5-flash",
  ) {}

  async available(): Promise<{ ok: boolean; detail: string }> {
    if (!this.apiKey) {
      return {
        ok: false,
        detail:
          "Gemini requires an API key. Set GEMINI_API_KEY or GOOGLE_API_KEY in your .env or environment.",
      };
    }
    return {
      ok: true,
      detail: `Google Gemini (${this.model}) with Google Search grounding`,
    };
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    if (req.images?.length) {
      throw new LlmError(
        "This Gemini provider wiring does not forward image input; this call requires a vision-capable provider (CANTE_LLM=api).",
        this.name,
      );
    }
    const started = Date.now();
    if (!this.apiKey) {
      throw new LlmError(
        "GEMINI_API_KEY or GOOGLE_API_KEY is not configured.",
        this.name,
      );
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const body: Record<string, unknown> = {
      contents: [
        {
          role: "user",
          parts: [{ text: req.prompt }],
        },
      ],
      systemInstruction: {
        parts: [{ text: req.system }],
      },
      generationConfig: {
        temperature: 0.2,
      },
    };

    if (req.schema) {
      (body.generationConfig as Record<string, unknown>).responseMimeType = "application/json";
      (body.generationConfig as Record<string, unknown>).responseSchema = zodToJsonSchema(req.schema);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), req.timeoutMs ?? 120_000);
    if (req.signal) {
      req.signal.addEventListener("abort", () => controller.abort());
    }

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini API returned status ${res.status}: ${errText.slice(0, 300)}`);
      }

      const data = await res.json();
      const text =
        data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

      return {
        text,
        provider: this.name,
        durationMs: Date.now() - started,
      };
    } catch (err: any) {
      throw new LlmError(
        `Gemini call failed: ${err instanceof Error ? err.message : String(err)}`,
        this.name,
        err,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async *stream(req: StreamRequest): AsyncIterable<StreamEvent> {
    if (!this.apiKey) {
      yield {
        type: "error",
        message: "GEMINI_API_KEY or GOOGLE_API_KEY is not set in environment.",
      };
      return;
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

    const body: Record<string, unknown> = {
      contents: [
        {
          role: "user",
          parts: [{ text: req.prompt }],
        },
      ],
      systemInstruction: {
        parts: [{ text: req.system }],
      },
      generationConfig: {
        temperature: 0.2,
      },
    };

    // If search tools requested, enable Google Search grounding tool
    if (req.tools && req.tools.includes("WebSearch")) {
      body.tools = [{ googleSearch: {} }];
    }

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: req.signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        yield {
          type: "error",
          message: `Gemini stream failed (${res.status}): ${errText.slice(0, 200)}`,
        };
        return;
      }

      if (!res.body) {
        yield { type: "error", message: "No response body from Gemini." };
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const jsonStr = trimmed.slice(6);
          if (jsonStr === "[DONE]") continue;

          try {
            const parsed = JSON.parse(jsonStr);
            const textChunk =
              parsed.candidates?.[0]?.content?.parts?.[0]?.text;
            if (textChunk) {
              yield { type: "text", text: textChunk };
            }

            // Check if search grounding metadata is returned
            const searchChunks =
              parsed.candidates?.[0]?.groundingMetadata?.groundingChunks;
            if (Array.isArray(searchChunks) && searchChunks.length > 0) {
              const results: SearchResult[] = searchChunks
                .filter((c: any) => c.web?.uri)
                .map((c: any) => {
                  let hostname = "";
                  try {
                    hostname = new URL(c.web.uri).hostname;
                  } catch {
                    hostname = c.web.uri;
                  }
                  return {
                    url: c.web.uri,
                    title: c.web.title || c.web.uri,
                    hostname,
                  };
                });
              if (results.length > 0) {
                yield {
                  type: "tool_end",
                  id: "gemini-search",
                  results,
                };
              }
            }
          } catch {
            // Ignore parse errors on partial lines
          }
        }
      }

      yield { type: "done" };
    } catch (err: any) {
      if (req.signal?.aborted) return;
      yield {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
