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

/**
 * Every tool that can change something. Passed to --disallowedTools on each
 * spawn.
 *
 * This is not paranoia — it is a fixed bug. `--allowedTools` is an
 * auto-APPROVE list, not a restriction, so pairing it with
 * `--permission-mode acceptEdits` let the model use Edit/Write/Bash freely. The
 * chat endpoint edited this repo's own docs before that was caught. The model
 * needs no write access for either judgment or chat: everything it reasons over
 * is already in the prompt.
 */
const DENIED_TOOLS = [
  "Bash",
  "Edit",
  "Write",
  "NotebookEdit",
  "Task",
  "Agent",
  "Skill",
  "KillShell",
  "SlashCommand",
];

/**
 * Scratch working directory for spawned CLI processes.
 *
 * Two reasons it isn't the project root. It keeps project files outside the
 * process's reach, and — the subtler one — a CLI started inside this repo loads
 * this repo's CLAUDE.md as its own standing instructions. Those instructions
 * say "update the docs when code changes", which is exactly what the chat
 * subprocess went and did.
 */
let scratchDir: string | undefined;
function getScratchDir(): string {
  if (!scratchDir) scratchDir = mkdtempSync(path.join(os.tmpdir(), "cante-llm-"));
  return scratchDir;
}

/** Yield complete lines from a stream, buffering partial ones across chunks. */
async function* readLines(stream: NodeJS.ReadableStream): AsyncIterable<string> {
  let buffer = "";
  for await (const chunk of stream) {
    buffer += chunk.toString();
    let index: number;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) yield line;
    }
  }
  if (buffer.trim()) yield buffer.trim();
}

/** Plumbing the user shouldn't see in the activity timeline. */
const HIDDEN_TOOLS = new Set(["ToolSearch"]);

/** Turn a raw tool call into something readable in the UI. */
function describeTool(
  name: string,
  input: Record<string, unknown>,
): { detail: string; url?: string; hostname?: string; hostnames?: string[] } {
  switch (name) {
    case "WebSearch":
      return {
        detail: String(input.query ?? "official sources"),
        hostnames: ["jdih.kemendag.go.id", "peraturan.bpk.go.id", "jdih.kemenkeu.go.id"],
      };
    case "WebFetch": {
      const url = String(input.url ?? "");
      try {
        const parsed = new URL(url);
        return { detail: parsed.hostname, url, hostname: parsed.hostname };
      } catch {
        return { detail: url };
      }
    }
    default:
      return { detail: name };
  }
}

function extractThinkingText(block: Record<string, unknown>): string | null {
  for (const key of ["thinking", "reasoning", "text", "summary"]) {
    const value = block[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Runs the model through the local `claude` CLI in headless mode.
 *
 * This is the whole point of v1: it uses the Claude Code login that already
 * exists on this machine, so running a check costs no API spend and needs no
 * key. The trade-off is that it's a subprocess, not a library — it only works
 * where the CLI is installed and logged in, which means locally.
 */
export class ClaudeCodeProvider implements LlmProvider {
  readonly name = "claude-code";

  constructor(private readonly bin = process.env.CLAUDE_BIN || "claude") {}

  async available() {
    try {
      const version = await this.run(["--version"], undefined, 10_000);
      return { ok: true, detail: `claude CLI ${version.trim()}` };
    } catch (err) {
      return {
        ok: false,
        detail:
          `\`${this.bin}\` is not runnable (${err instanceof Error ? err.message : String(err)}). ` +
          `Install Claude Code and log in, or set CLAUDE_BIN to its path.`,
      };
    }
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const started = Date.now();

    // The CLI has no structured-output parameter, so the schema goes into the
    // prompt. The caller validates the result against the same Zod object
    // either way, so a model that ignores this fails loudly rather than
    // quietly returning a different shape.
    const prompt = req.schema
      ? `${req.prompt}\n\n` +
        `## Output format\n\n` +
        `Reply with JSON only — no prose before or after it, no markdown code fence. ` +
        `It must validate against this JSON Schema:\n\n` +
        `${JSON.stringify(zodToJsonSchema(req.schema), null, 2)}`
      : req.prompt;

    // The judgment stage gets its data in the prompt and only needs to fetch
    // regulation detail pages. No file access, no shell.
    const args = [
      "-p",
      prompt,
      "--append-system-prompt",
      req.system,
      "--allowedTools",
      "WebFetch,WebSearch,ToolSearch",
      "--disallowedTools",
      ...DENIED_TOOLS,
    ];

    try {
      const text = await this.run(args, undefined, req.timeoutMs ?? 300_000, req.signal);
      return { text, provider: this.name, durationMs: Date.now() - started };
    } catch (err) {
      throw new LlmError(
        `claude CLI call failed: ${err instanceof Error ? err.message : String(err)}`,
        this.name,
        err,
      );
    }
  }

  /**
   * Streams progress by running the CLI in `--output-format stream-json` mode
   * and translating its NDJSON into StreamEvents.
   *
   * The CLI emits one JSON object per line: `system` on init, `assistant`
   * messages carrying text/thinking/tool_use blocks, `user` messages carrying
   * tool_results, and a final `result`. Anything unrecognised is ignored rather
   * than surfaced — new event types shouldn't break the UI.
   */
  async *stream(req: StreamRequest): AsyncIterable<StreamEvent> {
    const args = [
      "-p",
      req.prompt,
      "--append-system-prompt",
      req.system,
      "--output-format",
      "stream-json",
      "--verbose",
      "--disallowedTools",
      ...DENIED_TOOLS,
    ];
    if (req.tools?.length) {
      // ToolSearch is how the CLI loads deferred tools like WebSearch; without
      // it the model can't reach them.
      args.push("--allowedTools", [...req.tools, "ToolSearch"].join(","));
    }

    const child = spawn(this.bin, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
      cwd: getScratchDir(),
    });
    child.stdin.end();

    const timeoutMs = req.timeoutMs ?? 600_000;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    let aborted = req.signal?.aborted ?? false;
    const abort = () => {
      aborted = true;
      child.kill("SIGKILL");
    };
    req.signal?.addEventListener("abort", abort, { once: true });
    if (aborted) child.kill("SIGKILL");

    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));

    // Tool calls are matched to their results by id so the UI can close each
    // pill when its work finishes.
    const openTools = new Set<string>();
    let sawText = false;

    try {
      for await (const line of readLines(child.stdout)) {
        let event: Record<string, any>;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }

        if (event.type === "assistant") {
          for (const block of event.message?.content ?? []) {
            if (block.type === "text" && block.text) {
              sawText = true;
              yield { type: "text", text: block.text };
            } else if (block.type === "thinking") {
              const text = extractThinkingText(block);
              if (text) yield { type: "thinking", text };
            } else if (block.type === "tool_use") {
              if (HIDDEN_TOOLS.has(block.name)) continue;
              openTools.add(block.id);
              const tool = describeTool(block.name, block.input ?? {});
              yield {
                type: "tool_start",
                id: block.id,
                name: block.name,
                ...tool,
              };
            }
          }
        } else if (event.type === "user") {
          for (const block of event.message?.content ?? []) {
            if (block.type === "tool_result" && openTools.has(block.tool_use_id)) {
              openTools.delete(block.tool_use_id);
              yield { type: "tool_end", id: block.tool_use_id };
            }
          }
        } else if (event.type === "result") {
          if (event.subtype !== "success" && !sawText) {
            yield {
              type: "error",
              message: `The model ended without an answer (${event.subtype ?? "unknown"}).`,
            };
            return;
          }
        }
      }

      // Close anything still open — a killed process leaves pills spinning.
      for (const id of openTools) yield { type: "tool_end", id };

      if (aborted) return;

      const code: number | null = child.exitCode;
      if (code !== 0 && !sawText) {
        yield { type: "error", message: stderr.trim() || `claude exited with code ${code}` };
        return;
      }

      yield { type: "done" };
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener("abort", abort);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }

  private run(
    args: string[],
    input: string | undefined,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
        cwd: getScratchDir(),
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        reject(new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      const abort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill("SIGKILL");
        reject(new DOMException("Aborted", "AbortError"));
      };
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

      if (input !== undefined) child.stdin.write(input);
      child.stdin.end();
    });
  }
}
