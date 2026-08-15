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
import { getProvider } from "@/lib/llm";

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

Don't search when the question is purely about stored data — it's slower and adds nothing.

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

  const provider = getProvider();
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
    `${transcript}## Question\n\n${question}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Defensive: the client can disconnect mid-stream (closed tab, navigation),
      // after which enqueue throws. That must not take down the extraction that
      // follows.
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* client went away */
        }
      };

      // Tell the client which conversation this is, so a brand-new chat can
      // adopt the id and subsequent turns append to it.
      send({ type: "conversation", id: conversationId });

      let answer = "";
      const activity: { name: string; detail: string }[] = [];

      try {
        for await (const event of provider.stream!({
          system: SYSTEM_PROMPT,
          prompt,
          tools: ["WebSearch", "WebFetch"],
          timeoutMs: 600_000,
        })) {
          if (event.type === "text") answer += event.text;
          if (event.type === "tool_start") {
            activity.push({ name: event.name, detail: event.detail });
          }
          send(event);
        }
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        if (answer.trim()) {
          await appendMessage(conversationId, "agent", answer, activity);
          // Extraction happens after the answer is already on screen, so it
          // costs the user nothing. Deliberately not awaited.
          void extractMemories({
            customerId,
            question,
            answer,
            existing: memoryEntries,
          }).then(() => send({ type: "memory_updated" }))
            .catch(() => {})
            .finally(() => controller.close());
        } else {
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
