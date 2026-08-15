import { LlmError, type CompletionRequest, type CompletionResult, type LlmProvider } from "@/lib/llm/types";

/**
 * NOT IMPLEMENTED ON PURPOSE.
 *
 * v1 runs entirely on the local Claude Code login and spends nothing on API
 * usage. This file exists so that decision stays a one-file change rather
 * than a refactor: everything above `LlmProvider` is already provider-blind,
 * so filling this in and flipping CANTE_LLM=api is the whole switch.
 *
 * When that day comes, the implementation is roughly:
 *
 *   import Anthropic from "@anthropic-ai/sdk";
 *   const client = new Anthropic();               // reads ANTHROPIC_API_KEY
 *   const res = await client.messages.create({
 *     model: "claude-opus-5",
 *     max_tokens: 16000,
 *     system: req.system,
 *     thinking: { type: "adaptive" },
 *     output_config: {
 *       effort: "high",
 *       ...(req.schema && { format: zodOutputFormat(req.schema) }),
 *     },
 *     messages: [{ role: "user", content: req.prompt }],
 *   });
 *
 * Two things to get right at that point, both of which cost money to learn
 * the hard way:
 *   - The judgment prompt tells the model to fetch each candidate's detail
 *     page for its enactment date. Over the API that needs the server-side
 *     web_fetch tool declared explicitly; the CLI had it for free.
 *   - Run both providers over the same day's regulations.json and compare
 *     verdicts before trusting the switch. Same prompt and schema is not the
 *     same harness.
 */
export class ApiProvider implements LlmProvider {
  readonly name = "api";

  async available() {
    return {
      ok: false,
      detail:
        "The hosted API provider is intentionally not implemented yet — v1 runs " +
        "on the local Claude Code login so it costs nothing. Unset CANTE_LLM " +
        "(or set it to `claude-code`) to run locally.",
    };
  }

  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    throw new LlmError(
      "ApiProvider is a stub. See lib/llm/api.ts — implement it only when you " +
        "have decided to start paying for API usage.",
      this.name,
    );
  }
}
