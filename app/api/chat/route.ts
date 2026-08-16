import {
  appendMessage,
  createConversation,
  getConversation,
  getCustomerWithProfile,
  getDefaultCustomerId,
  getJurisdictionProfile,
  getRunHistory,
  listMemories,
  renderMemoryForPrompt,
} from "@/lib/db/queries";
import { extractMemories } from "@/lib/checks/remember";
import { getProvider, normalizeProviderChoice, PROVIDER_COOKIE } from "@/lib/llm";
import type { SearchResult } from "@/lib/llm/types";
import { normalizeJurisdiction, type JurisdictionName } from "@/lib/countries";

/** One tool call, stored with the message so a reopened chat replays it. */
type ChatActivity = {
  id: string;
  name: string;
  detail: string;
  url?: string;
  hostname?: string;
  results?: SearchResult[];
};

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
const INDONESIA_SYSTEM_PROMPT = `You answer questions about an Indonesian export-compliance monitor for a specific exporter.

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

Format your answer in Markdown: short paragraphs, **bold** for the thing that matters, bullet lists where there's more than one item, tables only for genuinely tabular facts. Keep it brief and concrete. Cite regulation numbers when you have them.`;

const UNITED_STATES_SYSTEM_PROMPT = `You answer questions about United States compliance for a specific manufacturer or distributor.

The selected jurisdiction is the United States. Keep domestic manufacturing, distribution, and export compliance as separate tracks.

You have two sources of truth:

1. **Stored Cante data below.** This is the only authority on what the monitor actually checked, which source succeeded or failed, what it found, and which customer facts are confirmed. Never dress a web result up as a stored check result.

2. **The web**, via WebSearch and WebFetch. Use it for fresh outside research. Prefer primary official sources: federalregister.gov, ecfr.gov, osha.gov, epa.gov, ftc.gov, cpsc.gov, fda.gov, usda.gov, fcc.gov, transportation.gov, bis.gov, census.gov, ofac.treasury.gov, cbp.gov, state.gov, and the applicable state/local government sites.

Search behavior:
- If the user asks for current, new, latest, recent, applicable, or changed regulations, search immediately before answering.
- Search against the facts actually recorded: facility location, NAICS, products, materials/SDS, processes, waste, labels/claims, distribution states, HTS/Schedule B, ECCN/EAR99, destinations, end users, and end use.
- Never infer missing NAICS, ECCN, permit status, waste classification, or product category. State what evidence is missing.
- A Federal Register proposal is not a current obligation. Publication date and effective date are different.
- A portal page being reachable is not complete regulatory coverage.
- For exports, screen classification, destination, parties, end use, AES/FTR, sanctions, and ITAR exposure separately.
- For state/local rules, use the recorded facility and distribution states. Do not generalize North Carolina coverage to another state.
- Cite the official source near every fresh claim and say explicitly when it came from web research rather than a stored run.

Format in concise Markdown. Use plain English, concrete next actions, and clear uncertainty. This is compliance triage, not a legal opinion.`;

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

  const existingConversation = body.conversationId
    ? await getConversation(body.conversationId)
    : null;
  const jurisdiction = normalizeJurisdiction(
    existingConversation?.conversation.jurisdiction ?? body.country,
  );
  const target = await getCustomerWithProfile(customerId);
  const jurisdictionProfile = await getJurisdictionProfile(customerId, jurisdiction);
  const history = await getRunHistory(customerId, 10, jurisdiction);

  const context = {
    customer: target?.customer,
    profile: target?.profile,
    jurisdiction,
    jurisdictionProfile,
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
    body.conversationId ?? (await createConversation(customerId, question, jurisdiction));
  const stored = existingConversation ?? (await getConversation(conversationId));
  const priorTurns = (stored?.messages ?? []).slice(-12);

  const transcript = priorTurns.length
    ? `## Conversation so far\n\n${priorTurns
        .map((m) => `**${m.role === "user" ? "User" : "You"}:** ${m.content}`)
        .join("\n\n")}\n\n`
    : "";

  const memoryEntries = await listMemories(customerId, jurisdiction);
  const memoryBlock = renderMemoryForPrompt(memoryEntries);

  await appendMessage(conversationId, "user", question);

  const prompt =
    `${memoryBlock}## Selected jurisdiction\n\n${jurisdiction}\n\n` +
    `## Stored run data\n\n${JSON.stringify(context, null, 2)}\n\n` +
    `${transcript}${buildSearchDirective(question, jurisdiction)}## Question\n\n${question}`;

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

      let answer = "";
      const activity: ChatActivity[] = [];
      const activityById = new Map<string, ChatActivity>();

      try {
        for await (const event of provider.stream!({
          system:
            jurisdiction === "United States"
              ? UNITED_STATES_SYSTEM_PROMPT
              : INDONESIA_SYSTEM_PROMPT,
          prompt,
          tools: ["WebSearch", "WebFetch"],
          timeoutMs: 600_000,
          signal: request.signal,
        })) {
          if (event.type === "text") {
            answer += event.text;
            send(event);
            continue;
          }
          if (event.type === "tool_start") {
            const item: ChatActivity = {
              id: event.id,
              name: event.name,
              detail: event.detail,
              url: event.url,
              hostname: event.hostname,
            };
            activity.push(item);
            activityById.set(event.id, item);
          }
          if (event.type === "tool_end" && event.results?.length) {
            // Store what the search actually returned, so reopening the
            // conversation shows the same links rather than a bare pill.
            const item = activityById.get(event.id);
            if (item) item.results = event.results;
          }
          if (event.type === "done") {
            continue;
          }
          send(event);
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
            jurisdiction,
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

function buildSearchDirective(question: string, jurisdiction: JurisdictionName): string {
  if (!needsFreshRegulatorySearch(question)) return "";
  if (jurisdiction === "United States") {
    return `## Search directive for this turn

This asks for fresh United States compliance research. Use WebSearch immediately. Start with official federal sources and the recorded facility/distribution states. Search the relevant track separately:
- domestic: Federal Register/eCFR plus OSHA, EPA, FTC, CPSC, or the product-specific agency
- distribution: official state tax, environmental, packaging/EPR/PFAS, consumer, and product-rule sources
- export: BIS/EAR, Census/FTR/AES, OFAC, CBP, and DDTC/ITAR only when facts support it

Clearly separate stored Cante coverage from web findings and disclose missing profile facts.

`;
  }
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
  const broadComplianceRequest = /\b(applicable|changed|updates?|requirements?|monitor|compliance)\b/.test(q);
  return wantsRegulations && (hasHsCode || broadComplianceRequest);
}
