import {
  appendMessage,
  createConversation,
  getConversation,
  getCustomerWithProfile,
  getDefaultCustomerId,
  getRunHistory,
  listMemories,
  renderMemoryForPrompt,
} from "@/lib/db/queries";
import { extractMemories } from "@/lib/checks/remember";
import { getProvider, normalizeProviderChoice, PROVIDER_COOKIE } from "@/lib/llm";
import type { LlmProvider } from "@/lib/llm/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * The chat can now reach the internet, which makes the grounding rules load
 * bearing rather than decorative: stored data is the only authority on what was
 * actually checked, and anything from the web has to be labelled as such. A
 * confident web answer that reads like a check result is the exact failure this
 * whole product is built to avoid.
 */
const SYSTEM_PROMPT = `You answer questions about an Indonesian export-compliance monitor for a specific exporter.

You have two sources of truth, and they are not interchangeable:

1. **The stored run data below.** This is the ONLY authority on what the monitor actually checked, what it found, which sources succeeded or failed, and what was sent to the customer. If the data doesn't contain the answer, say so plainly — never fill the gap from memory or the web and let it read as a check result.

2. **The web**, via WebSearch and WebFetch. Use it for outside context the stored runs can't give you: what a regulation actually says, background on an HS code, whether something changed recently. Prefer official Indonesian government sources (jdih.kemendag.go.id, peraturan.bpk.go.id, jdih.kemenkeu.go.id, bcsemarang.beacukai.go.id and the like).

**Always make clear which is which.** "The 14 Aug run flagged X" and "according to Kemendag's site, X says Y" are different claims and must read differently. When you use the web, name the source. Never present a web finding as something the monitor detected.

Search behavior:
- If the user asks for current/new/latest/recent regulations, asks you to "find" or "check" regulations, or provides HS codes and asks what changed, use WebSearch immediately before answering. Do not wait to see if stored runs are enough.
- For HS-code regulatory checks, run targeted searches against official domains first. Start with JDIH Kemendag and use queries that include the HS code, "ekspor", "Permendag", and the product/category. If results point to a relevant regulation page, WebFetch it.
- Keep the search pass tight unless the user asks for exhaustive research: usually 2 targeted WebSearch calls and at most 2-3 WebFetch reads are enough before answering with caveats.
- Use stored run data to say what the monitor has actually checked. Use web results to add current outside context. Label those separately.
- Don't search only when the question is purely about stored data, history, UI, memory, or what was already sent.

Visible reasoning:
- Start every response with a short user-facing reasoning block wrapped exactly in <visible_reasoning>...</visible_reasoning>.
- This is not hidden chain-of-thought. Keep it concise: 2-4 lines explaining what you are checking, what you need to verify, and whether you will use stored data, web search, or both.
- After the closing tag, write the normal Markdown answer. Do not mention the tags.

Format your answer in Markdown: short paragraphs, **bold** for the thing that matters, bullet lists where there's more than one item, tables only for genuinely tabular facts. Keep it brief and concrete. Cite regulation numbers when you have them.`;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const question: string | undefined = body.question?.trim();
  if (!question) {
    return Response.json({ error: "No question provided." }, { status: 400 });
  }

  const customerId: string | null = body.customerId ?? (await getDefaultCustomerId());
  if (!customerId) {
    return Response.json({ error: "No customers. Run `npm run db:seed`." }, { status: 404 });
  }

  const cookieProvider = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === PROVIDER_COOKIE)?.[1];
  const selectedProvider = normalizeProviderChoice(body.provider ?? cookieProvider);
  const provider = getProvider(selectedProvider);
  const health = await provider.available();
  if (!health.ok) {
    return Response.json({ error: health.detail }, { status: 503 });
  }
  if (!provider.stream) {
    return Response.json(
      { error: `Provider "${provider.name}" does not support streaming.` },
      { status: 501 },
    );
  }

  const target = await getCustomerWithProfile(customerId);
  const history = await getRunHistory(customerId, 10);

  const context = {
    customer: target?.customer,
    profile: target?.profile,
    recentRuns: history.map((h) => ({
      startedAt: h.run.startedAt,
      status: h.run.status,
      errorMessage: h.run.errorMessage,
      sources: h.sourceResults.map((r) => ({
        name: r.sourceName,
        success: r.success,
        entriesParsed: r.entriesParsed,
        error: r.errorMessage,
        parseWarning: r.parseWarning,
      })),
      findings: h.findings.map((f) => ({
        ref: f.regulationRef,
        title: f.title,
        url: f.url,
        relevance: f.relevance,
        enactedOn: f.enactedOn,
        reasoning: f.reasoning,
      })),
      alert: h.alert?.body ?? null,
    })),
  };

  // Conversations are persisted, so history comes from the database rather
  // than being trusted from the client. A fresh CLI process has no session of
  // its own — without this the chat can't answer "what did I just ask?".
  const conversationId: string =
    body.conversationId ?? (await createConversation(customerId, question));
  const stored = await getConversation(conversationId);
  const priorTurns = (stored?.messages ?? []).slice(-12);

  const transcript = priorTurns.length
    ? `## Conversation so far\n\n${priorTurns
        .map((m) => `**${m.role === "user" ? "User" : "You"}:** ${m.content}`)
        .join("\n\n")}\n\n`
    : "";

  const memoryEntries = await listMemories(customerId);
  const memoryBlock = renderMemoryForPrompt(memoryEntries);

  await appendMessage(conversationId, "user", question);

  const prompt =
    `${memoryBlock}## Stored run data\n\n${JSON.stringify(context, null, 2)}\n\n` +
    `${transcript}${buildSearchDirective(question)}## Question\n\n${question}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let clientGone = request.signal.aborted;
      const onAbort = () => {
        clientGone = true;
      };
      request.signal.addEventListener("abort", onAbort, { once: true });

      // Defensive: the client can disconnect mid-stream (closed tab, navigation),
      // after which enqueue throws. That must not take down the extraction that
      // follows.
      const send = (data: unknown) => {
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* client went away */
        }
      };

      // Tell the client which conversation this is, so a brand-new chat can
      // adopt the id and subsequent turns append to it.
      send({ type: "conversation", id: conversationId });
      for (const line of await buildVisibleReasoning({
        provider,
        question,
        usesFreshSearch: needsFreshRegulatorySearch(question),
        signal: request.signal,
      }).catch(() => [])) {
        send({ type: "thinking", text: line, source: "model" });
      }

      let answer = "";
      const visibleReasoning = createVisibleReasoningParser(send);
      const activity: {
        name: string;
        detail: string;
        url?: string;
        hostname?: string;
        hostnames?: string[];
      }[] = [];

      try {
        for await (const event of provider.stream!({
          system: SYSTEM_PROMPT,
          prompt,
          tools: ["WebSearch", "WebFetch"],
          timeoutMs: 600_000,
          signal: request.signal,
        })) {
          if (event.type === "text") {
            for (const text of visibleReasoning.push(event.text)) {
              answer += text;
              send({ type: "text", text });
            }
            continue;
          }
          if (event.type === "tool_start") {
            activity.push({
              name: event.name,
              detail: event.detail,
              url: event.url,
              hostname: event.hostname,
              hostnames: event.hostnames,
            });
          }
          if (event.type === "done") {
            continue;
          }
          send(event);
        }
        for (const text of visibleReasoning.flush()) {
          answer += text;
          send({ type: "text", text });
        }
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        request.signal.removeEventListener("abort", onAbort);
        if (answer.trim() && !clientGone) {
          await appendMessage(conversationId, "agent", answer, activity);
          send({ type: "done" });
          controller.close();
          // Extraction happens after the answer is stored and the stream is
          // closed, so it cannot keep the composer disabled.
          void extractMemories({
            customerId,
            question,
            answer,
            existing: memoryEntries,
            providerChoice: selectedProvider,
          }).catch(() => {});
        } else if (!clientGone) {
          controller.close();
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Without this, a proxy can sit on the stream and defeat the whole point.
      "X-Accel-Buffering": "no",
    },
  });
}

async function buildVisibleReasoning({
  provider,
  question,
  usesFreshSearch,
  signal,
}: {
  provider: LlmProvider;
  question: string;
  usesFreshSearch: boolean;
  signal: AbortSignal;
}): Promise<string[]> {
  const result = await provider.complete({
    system:
      "Write the visible reasoning panel for a chat UI. Do not answer the user's question. Do not use tools. Do not browse. Return only 2-4 short first-person lines, no bullets, no markdown, no tags.",
    prompt:
      `User question: ${question}\n\n` +
      `Will the main answer use fresh web search? ${usesFreshSearch ? "yes" : "only if needed"}\n\n` +
      "Write what you are about to check and why, in plain language.",
    timeoutMs: 30_000,
    signal,
  });
  return normalizeReasoningLines(result.text);
}

function buildSearchDirective(question: string): string {
  if (!needsFreshRegulatorySearch(question)) return "";
  return `## Search directive for this turn

This question appears to ask for fresh regulatory discovery. Before answering, use WebSearch immediately. Prefer official Indonesian government sources and run targeted searches for:
- the provided HS code(s), if any
- "Permendag", "ekspor", and the product/category
- jdih.kemendag.go.id first, then other official sources if needed

Use a tight first-pass budget: about 2 targeted WebSearch calls and at most 2-3 WebFetch reads, unless the user explicitly asks for exhaustive research. If coverage is incomplete, say that plainly instead of continuing to search indefinitely.

After searching, clearly separate:
- what Cante's stored monitor runs have actually checked
- what you found on the web in this chat turn

`;
}

function needsFreshRegulatorySearch(question: string): boolean {
  const q = question.toLowerCase();
  const hasHsCode = /\b\d{4}(?:[.\s-]?\d{2}){1,2}\b/.test(q) || /\bhs\s*codes?\b/.test(q);
  const wantsRegulations =
    /\b(new|latest|recent|current|today|now|find|search|check|look up)\b/.test(q) ||
    /\b(regulations?|rules?|peraturan|permendag|ekspor|export|compliance)\b/.test(q);
  return hasHsCode && wantsRegulations;
}

function createVisibleReasoningParser(send: (data: unknown) => void) {
  let buffer = "";
  let inReasoning = false;
  let done = false;

  const startRe = /<visible_reasoning>|<reasoning>/i;
  const endRe = /<\/visible_reasoning>|<\/reasoning>/i;

  const emitReasoning = (raw: string) => {
    for (const line of raw
      .split(/\r?\n/)
      .map((item) => item.replace(/^\s*[-*]\s*/, "").trim())
      .filter(Boolean)) {
      send({ type: "thinking", text: line, source: "model" });
    }
  };

  return {
    push(chunk: string): string[] {
      if (done) return [chunk];

      buffer += chunk;
      const output: string[] = [];

      if (!inReasoning) {
        const start = buffer.search(startRe);
        if (start === -1) {
          // Hold a small prefix while waiting for the model's visible-reasoning
          // tag. If it ignores the instruction, do not swallow the answer.
          if (buffer.length > 4096) {
            done = true;
            output.push(buffer);
            buffer = "";
          }
          return output;
        }

        const match = buffer.slice(start).match(startRe);
        if (!match) return output;
        const before = buffer.slice(0, start);
        if (before.trim()) output.push(before);
        buffer = buffer.slice(start + match[0].length);
        inReasoning = true;
      }

      const end = buffer.search(endRe);
      if (end === -1) return output;

      const match = buffer.slice(end).match(endRe);
      if (!match) return output;
      emitReasoning(buffer.slice(0, end));
      output.push(buffer.slice(end + match[0].length));
      buffer = "";
      inReasoning = false;
      done = true;
      return output;
    },

    flush(): string[] {
      if (!buffer) return [];
      const rest = buffer;
      buffer = "";
      done = true;
      return [rest];
    },
  };
}

function normalizeReasoningLines(raw: string): string[] {
  return raw
    .replace(/<\/?visible_reasoning>/gi, "")
    .replace(/<\/?reasoning>/gi, "")
    .split(/\r?\n/)
    .map((item) => item.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 4);
}
