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
  type StreamEvent,
  type StreamRequest,
} from "@/lib/llm/types";

let scratchDir: string | undefined;
function getScratchDir(): string {
  if (!scratchDir) scratchDir = mkdtempSync(path.join(os.tmpdir(), "cante-codex-"));
  return scratchDir;
}

/**
 * Local OpenAI/Codex path. This is deliberately CLI-backed rather than API-
 * backed, so switching to it can use a signed-in ChatGPT/Codex account without
 * adding OPENAI_API_KEY spend.
 */
export class CodexCliProvider implements LlmProvider {
  readonly name = "codex-cli";

  constructor(private readonly bin = process.env.CODEX_BIN || "codex") {}

  async available() {
    try {
      const version = await this.run(["--version"], 10_000);
      return { ok: true, detail: `codex CLI ${version.trim()}` };
    } catch (err) {
      const raw = err instanceof Error ? err.message.split("\n")[0] : String(err);
      const message = raw.includes("ENOENT")
        ? "installed wrapper is missing its platform binary"
        : raw;
      return {
        ok: false,
        detail:
          `\`${this.bin}\` is not runnable (${message}). ` +
          `Reinstall Codex CLI or set CODEX_BIN to a working binary.`,
      };
    }
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const started = Date.now();
    const prompt = req.schema
      ? `${req.prompt}\n\n` +
        `## Output format\n\n` +
        `Reply with JSON only — no prose before or after it, no markdown code fence. ` +
        `It must validate against this JSON Schema:\n\n` +
        `${JSON.stringify(zodToJsonSchema(req.schema), null, 2)}`
      : req.prompt;

    const args = [
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      `${req.system}\n\n${prompt}`,
    ];

    try {
      const text = await this.run(args, req.timeoutMs ?? 300_000, req.signal);
      return { text, provider: this.name, durationMs: Date.now() - started };
    } catch (err) {
      throw new LlmError(
        `codex CLI call failed: ${err instanceof Error ? err.message : String(err)}`,
        this.name,
        err,
      );
    }
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

  private run(args: string[], timeoutMs: number, signal?: AbortSignal): Promise<string> {
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
