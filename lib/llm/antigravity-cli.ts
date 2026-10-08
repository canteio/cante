import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
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

let scratchDir: string | undefined;
function getScratchDir(): string {
  if (!scratchDir) scratchDir = mkdtempSync(path.join(os.tmpdir(), "cante-agy-"));
  return scratchDir;
}

/**
 * Google Antigravity & Gemini Provider for Cante.
 * Supports:
 * 1. Local signed-in Antigravity CLI (agy) without API keys.
 * 2. Fallback to Gemini 2.5 Flash with Google Search grounding via GEMINI_API_KEY / GOOGLE_API_KEY.
 */
export class AntigravityCliProvider implements LlmProvider {
  readonly name = "antigravity";

  constructor(
    private readonly bin = process.env.ANTIGRAVITY_BIN ||
      process.env.AGY_BIN ||
      "agy",
    private readonly apiKey = process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GOOGLE_GENAI_API_KEY ||
      "",
    private readonly model = process.env.GEMINI_MODEL || "gemini-2.5-flash",
  ) {}

  async available(): Promise<{ ok: boolean; detail: string }> {
    // 1. Try local CLI first
    try {
      const version = await this.runCli(["--version"], 5_000);
      return { ok: true, detail: `Google Antigravity CLI ${version.trim()}` };
    } catch {
      // 2. Try Gemini API key if present
      if (this.apiKey) {
        return {
          ok: true,
          detail: `Google Gemini (${this.model}) with Google Search grounding`,
        };
      }

      return {
        ok: false,
        detail:
          `Antigravity CLI (${this.bin}) not found on PATH. ` +
          `Add \`agy\` to your PATH or set GEMINI_API_KEY in .env.`,
      };
    }
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    if (req.images?.length) {
      throw new LlmError(
        "Antigravity CLI provider does not support image input here; this call requires a vision-capable provider (CANTE_LLM=api).",
        this.name,
      );
    }
    const started = Date.now();

    // Check if CLI is runnable
    let isCliRunnable = false;
    try {
      await this.runCli(["--version"], 5_000);
      isCliRunnable = true;
    } catch {
      isCliRunnable = false;
    }

    if (isCliRunnable) {
      const prompt = req.schema
        ? `${req.prompt}\n\n` +
          `## Output format\n\n` +
          `Reply with JSON only — no prose before or after it, no markdown code fence. ` +
          `It must validate against this JSON Schema:\n\n` +
          `${JSON.stringify(zodToJsonSchema(req.schema), null, 2)}`
        : req.prompt;

      const args = ["-p", `${req.system}\n\n${prompt}`, "--output-format", "text"];
      try {
        const text = await this.runCli(args, req.timeoutMs ?? 300_000, req.signal);
        return { text, provider: this.name, durationMs: Date.now() - started };
      } catch (err) {
        throw new LlmError(
          `Antigravity CLI call failed: ${err instanceof Error ? err.message : String(err)}`,
          this.name,
          err,
        );
      }
    }

    // Fallback to Gemini REST engine if API key is set
    if (this.apiKey) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
      const body: Record<string, unknown> = {
        contents: [{ role: "user", parts: [{ text: req.prompt }] }],
        systemInstruction: { parts: [{ text: req.system }] },
        generationConfig: { temperature: 0.2 },
      };

      if (req.schema) {
        (body.generationConfig as Record<string, unknown>).responseMimeType = "application/json";
        (body.generationConfig as Record<string, unknown>).responseSchema = zodToJsonSchema(req.schema);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 120_000);
      if (req.signal) req.signal.addEventListener("abort", () => controller.abort());

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Gemini status ${res.status}: ${errText.slice(0, 300)}`);
        }

        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        return { text, provider: this.name, durationMs: Date.now() - started };
      } finally {
        clearTimeout(timer);
      }
    }

    throw new LlmError(
      `Neither Antigravity CLI (${this.bin}) nor GEMINI_API_KEY is configured.`,
      this.name,
    );
  }

  async *stream(req: StreamRequest): AsyncIterable<StreamEvent> {
    try {
      const result = await this.complete(req);
      if (req.signal?.aborted) return;
      yield { type: "text", text: result.text };
      yield { type: "done" };
    } catch (err) {
      if (req.signal?.aborted) return;
      yield { type: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }

  private runCli(args: string[], timeoutMs: number, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
        cwd: getScratchDir(),
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      const abort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill("SIGKILL");
        reject(new DOMException("Aborted", "AbortError"));
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        reject(new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();

      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        reject(err);
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (code === 0) resolve(stdout);
        else reject(new Error(`exit ${code}: ${stderr.trim() || stdout.trim() || "no output"}`));
      });

      child.stdin.end();
    });
  }
}
