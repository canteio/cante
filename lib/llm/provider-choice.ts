export type LlmProviderChoice = "claude-code" | "codex-cli" | "antigravity" | "api";

export const PROVIDER_COOKIE = "cante_llm";

export const PROVIDER_OPTIONS: {
  id: LlmProviderChoice;
  label: string;
  shortLabel: string;
  description: string;
}[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    shortLabel: "Claude",
    description: "Local Claude Code login. Current working default.",
  },
  {
    id: "codex-cli",
    label: "Codex / ChatGPT",
    shortLabel: "Codex",
    description: "Local Codex CLI signed in with ChatGPT/OpenAI. No API key.",
  },
  {
    id: "antigravity",
    label: "Antigravity / Gemini",
    shortLabel: "Antigravity",
    description: "Local Antigravity (agy) session signed in with Google. No API key.",
  },
  {
    id: "api",
    label: "Hosted API",
    shortLabel: "API",
    description: "Intentionally disabled until API spend is approved.",
  },
];

export function normalizeProviderChoice(value: unknown): LlmProviderChoice {
  const choice = String(value ?? "").toLowerCase();
  if (choice === "codex" || choice === "openai" || choice === "chatgpt") return "codex-cli";
  if (choice === "antigravity" || choice === "agy" || choice === "gemini" || choice === "google") return "antigravity";
  if (choice === "codex-cli" || choice === "claude-code" || choice === "antigravity" || choice === "api") return choice;
  return "claude-code";
}
