import { randomUUID } from "node:crypto";
import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  alerts,
  chatMessages,
  checkRuns,
  checklistItems,
  conversations,
  customerProfiles,
  customers,
  findings,
  jurisdictionProfiles,
  memories,
  sourceResults,
  sources,
  type ChecklistItem,
  type ChatMessage,
  type Conversation,
  type Customer,
  type CustomerProfile,
  type JurisdictionProfile,
  type Memory,
  type MessageActivity,
} from "@/lib/db/schema";
import { DEFAULT_JURISDICTION, type JurisdictionName } from "@/lib/countries";

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

export async function getJurisdictionProfile(
  customerId: string,
  country: JurisdictionName,
): Promise<JurisdictionProfile | null> {
  return (
    db
      .select()
      .from(jurisdictionProfiles)
      .where(
        and(
          eq(jurisdictionProfiles.customerId, customerId),
          eq(jurisdictionProfiles.country, country),
        ),
      )
      .get() ?? null
  );
}

export async function upsertJurisdictionProfile(
  customerId: string,
  country: JurisdictionName,
  values: Partial<
    Pick<
      JurisdictionProfile,
      | "legalName"
      | "facilityAddresses"
      | "naicsCodes"
      | "products"
      | "skus"
      | "materialsChemicals"
      | "manufacturingProcesses"
      | "wasteStreams"
      | "distributionStates"
      | "labelsClaims"
      | "htsScheduleBCodes"
      | "exportClassifications"
      | "exportCountries"
      | "regulatedProductFlags"
    >
  >,
): Promise<JurisdictionProfile> {
  const existing = await getJurisdictionProfile(customerId, country);
  const updatedAt = new Date().toISOString();
  if (existing) {
    db.update(jurisdictionProfiles)
      .set({ ...values, updatedAt })
      .where(eq(jurisdictionProfiles.id, existing.id))
      .run();
    return (await getJurisdictionProfile(customerId, country))!;
  }

  db.insert(jurisdictionProfiles)
    .values({
      id: randomUUID(),
      customerId,
      country,
      legalName: values.legalName ?? null,
      facilityAddresses: values.facilityAddresses ?? [],
      naicsCodes: values.naicsCodes ?? [],
      products: values.products ?? [],
      skus: values.skus ?? [],
      materialsChemicals: values.materialsChemicals ?? [],
      manufacturingProcesses: values.manufacturingProcesses ?? [],
      wasteStreams: values.wasteStreams ?? [],
      distributionStates: values.distributionStates ?? [],
      labelsClaims: values.labelsClaims ?? [],
      htsScheduleBCodes: values.htsScheduleBCodes ?? [],
      exportClassifications: values.exportClassifications ?? [],
      exportCountries: values.exportCountries ?? [],
      regulatedProductFlags: values.regulatedProductFlags ?? [],
      updatedAt,
    })
    .run();
  return (await getJurisdictionProfile(customerId, country))!;
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
export async function getRunHistory(
  customerId: string,
  limit = 30,
  jurisdiction: JurisdictionName = DEFAULT_JURISDICTION,
) {
  reapStaleRuns();

  const runs = db
    .select()
    .from(checkRuns)
    .where(
      and(eq(checkRuns.customerId, customerId), eq(checkRuns.jurisdiction, jurisdiction)),
    )
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

/**
 * A run only leaves "running" from inside its own process, so a killed
 * `npm run check` — or a dev-server restart mid-check — strands the row and
 * the dashboard shows a check that never finishes. Nothing can still be
 * running after an hour: a full check takes minutes.
 */
export function reapStaleRuns(maxAgeMs = 60 * 60 * 1000): number {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const stale = db
    .select({ id: checkRuns.id })
    .from(checkRuns)
    .where(and(eq(checkRuns.status, "running"), lt(checkRuns.startedAt, cutoff)))
    .all();

  for (const run of stale) {
    db.update(checkRuns)
      .set({
        status: "failed",
        completedAt: new Date().toISOString(),
        errorMessage:
          "Interrupted — the process exited before the run completed. Its source results " +
          "are still accurate; its judgment never ran.",
      })
      .where(eq(checkRuns.id, run.id))
      .run();
  }

  return stale.length;
}

/* ─── Conversations ──────────────────────────────────────────────── */

export async function listConversations(
  customerId: string,
  jurisdiction: JurisdictionName = DEFAULT_JURISDICTION,
): Promise<Conversation[]> {
  return db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.customerId, customerId),
        eq(conversations.jurisdiction, jurisdiction),
      ),
    )
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

export async function createConversation(
  customerId: string,
  title: string,
  jurisdiction: JurisdictionName = DEFAULT_JURISDICTION,
): Promise<string> {
  const id = randomUUID();
  db.insert(conversations)
    .values({ id, customerId, jurisdiction, title: truncateTitle(title) })
    .run();
  return id;
}

export async function appendMessage(
  conversationId: string,
  role: "user" | "agent",
  content: string,
  activity: MessageActivity[] = [],
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

export async function listMemories(
  customerId: string,
  jurisdiction?: JurisdictionName,
): Promise<Memory[]> {
  return db
    .select()
    .from(memories)
    .where(
      jurisdiction
        ? and(eq(memories.customerId, customerId), eq(memories.jurisdiction, jurisdiction))
        : eq(memories.customerId, customerId),
    )
    .orderBy(desc(memories.confirmed), desc(memories.createdAt))
    .all();
}

export async function getMemory(id: string): Promise<Memory | null> {
  return db.select().from(memories).where(eq(memories.id, id)).get() ?? null;
}

export async function addMemory(entry: {
  customerId: string;
  jurisdiction?: JurisdictionName;
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
    .where(
      and(
        eq(memories.customerId, entry.customerId),
        eq(memories.jurisdiction, entry.jurisdiction ?? DEFAULT_JURISDICTION),
      ),
    )
    .all();
  const normalised = content.toLowerCase();
  if (existing.some((m) => m.content.trim().toLowerCase() === normalised)) return null;

  const row = {
    id: randomUUID(),
    customerId: entry.customerId,
    jurisdiction: entry.jurisdiction ?? DEFAULT_JURISDICTION,
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

/* ─── Checklist ─────────────────────────────────────────────────── */

export async function listChecklistItems(
  customerId: string,
  jurisdiction: JurisdictionName = DEFAULT_JURISDICTION,
): Promise<ChecklistItem[]> {
  return db
    .select()
    .from(checklistItems)
    .where(
      and(
        eq(checklistItems.customerId, customerId),
        eq(checklistItems.jurisdiction, jurisdiction),
      ),
    )
    .orderBy(checklistItems.category, desc(checklistItems.priority), desc(checklistItems.updatedAt))
    .all();
}

export async function updateChecklistItemStatus(id: string, status: string): Promise<void> {
  db.update(checklistItems)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(eq(checklistItems.id, id))
    .run();
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
export async function getSeenRegulations(
  customerId: string,
  jurisdiction: JurisdictionName = DEFAULT_JURISDICTION,
) {
  return db
    .select({
      regulationRef: findings.regulationRef,
      title: findings.title,
      url: findings.url,
      relevance: findings.relevance,
      createdAt: findings.createdAt,
    })
    .from(findings)
    .innerJoin(checkRuns, eq(findings.checkRunId, checkRuns.id))
    .where(
      and(eq(findings.customerId, customerId), eq(checkRuns.jurisdiction, jurisdiction)),
    )
    .orderBy(desc(findings.createdAt))
    .all();
}
