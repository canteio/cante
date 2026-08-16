import type { ZodType } from "zod";

/**
 * The seam.
 *
 * Nothing above this interface knows whether the words came from the local
 * Claude Code CLI or from a hosted API call. Today only the Claude Code
 * provider is implemented, because v1 deliberately spends nothing on API
 * usage — see lib/llm/api.ts for the stub that gets filled in when that
 * changes.
 *
 * Providers return raw text. They do NOT validate. Parsing and schema
 * validation happen once, above the seam, so the two providers cannot drift
 * into accepting different shapes.
 */
export interface LlmProvider {
  readonly name: string;
  /** Is this provider usable right now? Checked before a run starts. */
  available(): Promise<{ ok: boolean; detail: string }>;
  complete(req: CompletionRequest): Promise<CompletionResult>;
  /**
   * Optional. Yields progress as the model works — tool calls, thinking,
   * incremental text — so the UI can show what's happening instead of a spinner.
   * Callers must handle absence: a provider without it still works via
   * `complete()`, just with no visible progress.
   */
  stream?(req: StreamRequest): AsyncIterable<StreamEvent>;
}

export interface StreamRequest extends CompletionRequest {
  /**
   * Tool names the model may use for this call, e.g. ["WebSearch", "WebFetch"].
   * Omitted means no tools.
   */
  tools?: string[];
}

export type StreamEvent =
  /** The model started a tool call. `detail` is a short human-readable summary. */
  | {
      type: "tool_start";
      id: string;
      name: string;
      detail: string;
      url?: string;
      hostname?: string;
      hostnames?: string[];
    }
  | { type: "tool_end"; id: string }
  /** A safe, user-visible reasoning part or progress summary. */
  | { type: "thinking"; text?: string; source?: "model" | "provider" | "system" }
  /** A chunk of the answer. Concatenate in arrival order. */
  | { type: "text"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

export interface CompletionRequest {
  /** Standing instructions — role, constraints, tone. */
  system: string;
  /** The actual task for this call. */
  prompt: string;
  /**
   * When set, the caller wants JSON matching this schema. Providers surface
   * the shape to the model however their transport allows; the caller still
   * validates the result itself.
   */
  schema?: ZodType;
  /** Rough ceiling on how long the model may work, in ms. */
  timeoutMs?: number;
  /** Abort signal from the caller, used to terminate CLI-backed streams. */
  signal?: AbortSignal;
}

export interface CompletionResult {
  text: string;
  provider: string;
  /** Wall-clock duration of the call, for the run log. */
  durationMs: number;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LlmError";
  }
}
