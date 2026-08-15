import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  alerts,
  chatMessages,
  checkRuns,
  conversations,
  customerProfiles,
  customers,
  findings,
  memories,
  sourceResults,
  sources,
  type ChatMessage,
  type Conversation,
  type Customer,
  type CustomerProfile,
  type Memory,
} from "@/lib/db/schema";

export async function listCustomers(): Promise<Customer[]> {
  return db.select().from(customers).orderBy(customers.name).all();
}

export async function getCustomerWithProfile(
  customerId: string,
): Promise<{ customer: Customer; profile: CustomerProfile } | null> {
  const customer = db.select().from(customers).where(eq(customers.id, customerId)).get();
  if (!customer) return null;
  const profile = db
    .select()
    .from(customerProfiles)
    .where(eq(customerProfiles.customerId, customerId))
    .get();
  if (!profile) return null;
  return { customer, profile };
}

export async function getDefaultCustomerId(): Promise<string | null> {
  const first = db.select({ id: customers.id }).from(customers).orderBy(customers.name).get();
  return first?.id ?? null;
}

export async function listSources() {
  return db.select().from(sources).orderBy(sources.name).all();
}

/**
 * Everything the dashboard renders for one run, including per-source results —
 * a run is never shown without the evidence of which sources actually worked.
 */
export async function getRunHistory(customerId: string, limit = 30) {
  const runs = db
    .select()
    .from(checkRuns)
    .where(eq(checkRuns.customerId, customerId))
    .orderBy(desc(checkRuns.startedAt))
    .limit(limit)
    .all();

  return runs.map((run) => {
    const results = db
      .select({
        id: sourceResults.id,
        sourceId: sourceResults.sourceId,
        success: sourceResults.success,
        errorMessage: sourceResults.errorMessage,
        entriesParsed: sourceResults.entriesParsed,
        parseWarning: sourceResults.parseWarning,
        sourceName: sources.name,
        domain: sources.domain,
        view: sources.view,
      })
      .from(sourceResults)
      .leftJoin(sources, eq(sourceResults.sourceId, sources.id))
      .where(eq(sourceResults.checkRunId, run.id))
      .all();

    const runFindings = db
      .select()
      .from(findings)
      .where(eq(findings.checkRunId, run.id))
      .all();

    const runAlert = db.select().from(alerts).where(eq(alerts.checkRunId, run.id)).get();

    return { run, sourceResults: results, findings: runFindings, alert: runAlert ?? null };
  });
}

export type RunHistoryEntry = Awaited<ReturnType<typeof getRunHistory>>[number];

/* ─── Conversations ──────────────────────────────────────────────── */

export async function listConversations(customerId: string): Promise<Conversation[]> {
  return db
    .select()
    .from(conversations)
    .where(eq(conversations.customerId, customerId))
    .orderBy(desc(conversations.updatedAt))
    .all();
}

export async function getConversation(
  id: string,
): Promise<{ conversation: Conversation; messages: ChatMessage[] } | null> {
  const conversation = db.select().from(conversations).where(eq(conversations.id, id)).get();
  if (!conversation) return null;
  const msgs = db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, id))
    .orderBy(chatMessages.createdAt)
    .all();
  return { conversation, messages: msgs };
}

export async function createConversation(customerId: string, title: string): Promise<string> {
  const id = randomUUID();
  db.insert(conversations).values({ id, customerId, title: truncateTitle(title) }).run();
  return id;
}

export async function appendMessage(
  conversationId: string,
  role: "user" | "agent",
  content: string,
  activity: { name: string; detail: string }[] = [],
): Promise<void> {
  db.insert(chatMessages)
    .values({ id: randomUUID(), conversationId, role, content, activity })
    .run();
  db.update(conversations)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(conversations.id, conversationId))
    .run();
}

export async function deleteConversation(id: string): Promise<void> {
  db.delete(chatMessages).where(eq(chatMessages.conversationId, id)).run();
  db.delete(conversations).where(eq(conversations.id, id)).run();
}

/** First question makes the title — same convention as every chat app. */
function truncateTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean || "New chat";
}

/* ─── Memory ─────────────────────────────────────────────────────── */

export async function listMemories(customerId: string): Promise<Memory[]> {
  return db
    .select()
    .from(memories)
    .where(eq(memories.customerId, customerId))
    .orderBy(desc(memories.confirmed), desc(memories.createdAt))
    .all();
}

export async function addMemory(entry: {
  customerId: string;
  kind: string;
  content: string;
  source?: string | null;
  origin?: string;
  confirmed?: boolean;
}): Promise<Memory | null> {
  const content = entry.content.trim();
  if (!content) return null;

  // Cheap duplicate guard — the background extractor re-reads the same
  // conversation on every turn and would otherwise restate the same fact.
  const existing = db
    .select()
    .from(memories)
    .where(eq(memories.customerId, entry.customerId))
    .all();
  const normalised = content.toLowerCase();
  if (existing.some((m) => m.content.trim().toLowerCase() === normalised)) return null;

  const row = {
    id: randomUUID(),
    customerId: entry.customerId,
    kind: entry.kind,
    content,
    source: entry.source ?? null,
    origin: entry.origin ?? "manual",
    confirmed: entry.confirmed ?? false,
  };
  db.insert(memories).values(row).run();
  return db.select().from(memories).where(eq(memories.id, row.id)).get() ?? null;
}

export async function setMemoryConfirmed(id: string, confirmed: boolean): Promise<void> {
  db.update(memories).set({ confirmed }).where(eq(memories.id, id)).run();
}

export async function deleteMemory(id: string): Promise<void> {
  db.delete(memories).where(eq(memories.id, id)).run();
}

/**
 * Renders memory for a prompt, keeping confirmed and unconfirmed visibly
 * apart. Both the chat and the judgment stage use this, so the two can't
 * develop different ideas about what counts as established.
 */
export function renderMemoryForPrompt(entries: Memory[]): string {
  if (entries.length === 0) return "";
  const confirmed = entries.filter((m) => m.confirmed);
  const unconfirmed = entries.filter((m) => !m.confirmed);

  const fmt = (m: Memory) =>
    `  - [${m.kind}] ${m.content}${m.source ? ` (source: ${m.source})` : ""}`;

  let out = "## What you know about this customer\n\n";
  if (confirmed.length) {
    out += `Confirmed — treat as established fact:\n${confirmed.map(fmt).join("\n")}\n\n`;
  }
  if (unconfirmed.length) {
    out +=
      `NOT confirmed — leads only. A human has not verified these. Never present ` +
      `one as a checked fact, and say it's unconfirmed if you rely on it:\n` +
      `${unconfirmed.map(fmt).join("\n")}\n\n`;
  }
  return out;
}

/** Regulations already flagged in past runs — the dedup log. */
export async function getSeenRegulations(customerId: string) {
  return db
    .select({
      regulationRef: findings.regulationRef,
      title: findings.title,
      url: findings.url,
      relevance: findings.relevance,
      createdAt: findings.createdAt,
    })
    .from(findings)
    .where(eq(findings.customerId, customerId))
    .orderBy(desc(findings.createdAt))
    .all();
}
