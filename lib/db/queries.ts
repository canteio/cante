import { randomUUID } from "node:crypto";
import {
  type ChecklistItem,
  type ChatMessage,
  type CheckRun,
  type Conversation,
  type Customer,
  type CustomerProfile,
  type Alert,
  type Finding,
  type JurisdictionProfile,
  type Memory,
  type MessageActivity,
  type Source,
} from "@/lib/db/schema";
import { DEFAULT_JURISDICTION, type JurisdictionName } from "@/lib/countries";
import { getAuthMode } from "@/lib/auth/config";
import { createClient as createSupabaseClient, getAuthenticatedWorkspace } from "@/lib/supabase/server";

function camelKey(key: string) {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function camelRow<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((item) => camelRow(item)) as T;
  if (!value || typeof value !== "object") return value as T;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      camelKey(key),
      camelRow(item),
    ]),
  ) as T;
}

function snakeKey(key: string) {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function snakeRow(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [snakeKey(key), item]));
}

function cloudError(scope: string, error: { message: string } | null) {
  if (error) throw new Error(`Supabase ${scope} failed: ${error.message}`);
}

export async function listCustomers(): Promise<Customer[]> {
  const supabase = await createSupabaseClient();
  const rows: unknown[] = [];
  // PostgREST limits each response; one successful query is not the full list.
  // A stable tie-breaker preserves ordering when customer names repeat.
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from("customers").select("*")
      .order("name").order("id").range(offset, offset + 499);
    cloudError("customers read", error);
    rows.push(...(data ?? []));
    if (!data || data.length < 500) break;
  }
  return camelRow<Customer[]>(rows);
}

export async function getCustomerWithProfile(
  customerId: string,
): Promise<{ customer: Customer; profile: CustomerProfile } | null> {
  const supabase = await createSupabaseClient();
  const [{ data: customer, error: customerError }, { data: profile, error: profileError }] =
    await Promise.all([
      supabase.from("customers").select("*").eq("id", customerId).maybeSingle(),
      supabase.from("customer_profiles").select("*").eq("customer_id", customerId).maybeSingle(),
    ]);
  cloudError("customer read", customerError);
  cloudError("customer profile read", profileError);
  return customer && profile
    ? { customer: camelRow<Customer>(customer), profile: camelRow<CustomerProfile>(profile) }
    : null;
}

export async function getJurisdictionProfile(
  customerId: string,
  country: JurisdictionName,
): Promise<JurisdictionProfile | null> {
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("jurisdiction_profiles")
    .select("*")
    .eq("customer_id", customerId)
    .eq("country", country)
    .maybeSingle();
  cloudError("jurisdiction profile read", error);
  return data ? camelRow<JurisdictionProfile>(data) : null;
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
  const supabase = await createSupabaseClient();
  const existing = await getJurisdictionProfile(customerId, country);
  const row = snakeRow({
    id: existing?.id ?? randomUUID(),
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
    updatedAt: new Date().toISOString(),
  });
  const { data, error } = await supabase
    .from("jurisdiction_profiles")
    .upsert(row, { onConflict: "customer_id,country", ignoreDuplicates: false })
    .select("*")
    .single();
  cloudError("jurisdiction profile write", error);
  return camelRow<JurisdictionProfile>(data);
}

export async function getDefaultCustomerId(): Promise<string | null> {
  return (await getAuthenticatedWorkspace())?.customerId ?? null;
}

/** API routes must derive the workspace from auth in production. */
export async function resolveCustomerId(
  requestedCustomerId?: string | null,
): Promise<string | null> {
  if (getAuthMode() === "supabase") {
    return (await getAuthenticatedWorkspace(requestedCustomerId))?.customerId ?? null;
  }
  return requestedCustomerId ?? getDefaultCustomerId();
}

export async function listSources(): Promise<Source[]> {
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase.from("sources").select("*").order("name");
  cloudError("sources read", error);
  return camelRow<Source[]>(data ?? []);
}

/**
 * Everything the dashboard renders for one run, including per-source results —
 * a run is never shown without the evidence of which sources actually worked.
 */
export async function getRunHistory(
  customerId: string,
  limit = 30,
  jurisdiction: JurisdictionName = DEFAULT_JURISDICTION,
): Promise<RunHistoryEntry[]> {
  const supabase = await createSupabaseClient();
  const { data: cloudRuns, error: runsError } = await supabase
    .from("check_runs")
    .select("*")
    .eq("customer_id", customerId)
    .eq("jurisdiction", jurisdiction)
    .order("started_at", { ascending: false })
    .limit(limit);
  cloudError("run history read", runsError);

  return Promise.all(
    (cloudRuns ?? []).map(async (rawRun) => {
      const [{ data: results, error: resultsError }, { data: runFindings, error: findingsError }, { data: runAlert, error: alertError }] =
        await Promise.all([
          supabase
            .from("source_results")
            .select("*, sources(name, domain, view)")
            .eq("check_run_id", rawRun.id),
          supabase.from("findings").select("*").eq("check_run_id", rawRun.id),
          supabase.from("alerts").select("*").eq("check_run_id", rawRun.id).maybeSingle(),
        ]);
      cloudError("source results read", resultsError);
      cloudError("findings read", findingsError);
      cloudError("alert read", alertError);

      const sourceRows = (results ?? []).map((result) => {
        const source = Array.isArray(result.sources) ? result.sources[0] : result.sources;
        return camelRow({
          ...result,
          sources: undefined,
          source_name: source?.name ?? null,
          domain: source?.domain ?? null,
          view: source?.view ?? null,
        });
      });
      return {
        run: camelRow<CheckRun>(rawRun),
        sourceResults: sourceRows as RunHistorySourceResult[],
        findings: camelRow<Finding[]>(runFindings ?? []),
        alert: runAlert ? camelRow<Alert>(runAlert) : null,
      };
    }),
  );
}

export type RunHistorySourceResult = {
  id: string;
  sourceId: string;
  success: boolean;
  errorMessage: string | null;
  entriesParsed: number;
  parseWarning: string | null;
  sourceName: string | null;
  domain: string | null;
  view: string | null;
};

export type RunHistoryEntry = {
  run: CheckRun;
  sourceResults: RunHistorySourceResult[];
  findings: Finding[];
  alert: Alert | null;
};

/**
 * A run only leaves "running" from inside its own process, so a killed
 * `npm run check` — or a dev-server restart mid-check — strands the row and
 * the dashboard shows a check that never finishes. Nothing can still be
 * running after an hour: a full check takes minutes.
 */
export async function reapStaleRuns(maxAgeMs = 60 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("check_runs")
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message:
        "Interrupted — the process exited before the run completed. Its source results " +
        "are still accurate; its judgment never ran.",
    })
    .eq("status", "running")
    .lt("started_at", cutoff)
    .select("id");
  cloudError("stale runs update", error);
  return data?.length ?? 0;
}

/* ─── Conversations ──────────────────────────────────────────────── */

export async function listConversations(
  customerId: string,
  jurisdiction: JurisdictionName = DEFAULT_JURISDICTION,
): Promise<Conversation[]> {
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("customer_id", customerId)
    .eq("jurisdiction", jurisdiction)
    .order("updated_at", { ascending: false });
  cloudError("conversations read", error);
  return camelRow<Conversation[]>(data ?? []);
}

export async function getConversation(
  id: string,
): Promise<{ conversation: Conversation; messages: ChatMessage[] } | null> {
  const supabase = await createSupabaseClient();
  const [{ data: conversation, error: conversationError }, { data: messages, error: messagesError }] =
    await Promise.all([
      supabase.from("conversations").select("*").eq("id", id).maybeSingle(),
      supabase.from("chat_messages").select("*").eq("conversation_id", id).order("created_at"),
    ]);
  cloudError("conversation read", conversationError);
  cloudError("messages read", messagesError);
  return conversation
    ? {
        conversation: camelRow<Conversation>(conversation),
        messages: camelRow<ChatMessage[]>(messages ?? []),
      }
    : null;
}

export async function createConversation(
  customerId: string,
  title: string,
  jurisdiction: JurisdictionName = DEFAULT_JURISDICTION,
): Promise<string> {
  const id = randomUUID();
  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("conversations").insert({
    id,
    customer_id: customerId,
    jurisdiction,
    title: truncateTitle(title),
  });
  cloudError("conversation create", error);
  return id;
}

export async function appendMessage(
  conversationId: string,
  role: "user" | "agent",
  content: string,
  activity: MessageActivity[] = [],
): Promise<void> {
  const supabase = await createSupabaseClient();
  const now = new Date().toISOString();
  const [{ error: messageError }, { error: conversationError }] = await Promise.all([
    supabase.from("chat_messages").insert({
      id: randomUUID(),
      conversation_id: conversationId,
      role,
      content,
      activity,
    }),
    supabase.from("conversations").update({ updated_at: now }).eq("id", conversationId),
  ]);
  cloudError("message create", messageError);
  cloudError("conversation touch", conversationError);
  return;
}

export async function deleteConversation(id: string): Promise<void> {
  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("conversations").delete().eq("id", id);
  cloudError("conversation delete", error);
  return;
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
  const supabase = await createSupabaseClient();
  let query = supabase
    .from("memories")
    .select("*")
    .eq("customer_id", customerId)
    .eq("status", "active");
  if (jurisdiction) query = query.eq("jurisdiction", jurisdiction);
  const { data, error } = await query
    .order("confirmed", { ascending: false })
    .order("created_at", { ascending: false });
  cloudError("memories read", error);
  return camelRow<Memory[]>(data ?? []);
}

export async function getMemory(id: string): Promise<Memory | null> {
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase.from("memories").select("*").eq("id", id).maybeSingle();
  cloudError("memory read", error);
  return data ? camelRow<Memory>(data) : null;
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

  const existing = await listMemories(
    entry.customerId,
    entry.jurisdiction ?? DEFAULT_JURISDICTION,
  );
  const normalised = content.toLowerCase();
  if (existing.some((memory) => memory.content.trim().toLowerCase() === normalised)) return null;

  const supabase = await createSupabaseClient();
  const id = randomUUID();
  const { data, error } = await supabase
    .from("memories")
    .insert({
      id,
      customer_id: entry.customerId,
      jurisdiction: entry.jurisdiction ?? DEFAULT_JURISDICTION,
      kind: entry.kind,
      content,
      source: entry.source ?? null,
      origin: entry.origin ?? "manual",
      confirmed: entry.confirmed ?? false,
    })
    .select("*")
    .single();
  cloudError("memory create", error);
  return camelRow<Memory>(data);
}

export async function setMemoryConfirmed(id: string, confirmed: boolean): Promise<void> {
  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("memories")
    .update({ confirmed, updated_at: new Date().toISOString() })
    .eq("id", id);
  cloudError("memory update", error);
  return;
}

export async function deleteMemory(id: string): Promise<void> {
  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("memories").delete().eq("id", id);
  cloudError("memory delete", error);
  return;
}

/* ─── Checklist ─────────────────────────────────────────────────── */

export async function listChecklistItems(
  customerId: string,
  jurisdiction: JurisdictionName = DEFAULT_JURISDICTION,
): Promise<ChecklistItem[]> {
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("checklist_items")
    .select("*")
    .eq("customer_id", customerId)
    .eq("jurisdiction", jurisdiction)
    .order("category")
    .order("priority", { ascending: false })
    .order("updated_at", { ascending: false });
  cloudError("checklist read", error);
  return camelRow<ChecklistItem[]>(data ?? []);
}

export async function updateChecklistItemStatus(id: string, status: string): Promise<boolean> {
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("checklist_items")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    // Request the matched row so callers can distinguish an update from a no-op.
    .select("id")
    .maybeSingle();
  cloudError("checklist update", error);
  return data !== null;
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
): Promise<Pick<Finding, "regulationRef" | "title" | "url" | "relevance" | "createdAt">[]> {
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("findings")
    .select("regulation_ref, title, url, relevance, created_at, check_runs!inner(jurisdiction)")
    .eq("customer_id", customerId)
    .eq("check_runs.jurisdiction", jurisdiction)
    .order("created_at", { ascending: false });
  cloudError("seen regulations read", error);
  return (data ?? []).map((row) => ({
    regulationRef: row.regulation_ref,
    title: row.title,
    url: row.url,
    relevance: row.relevance,
    createdAt: row.created_at,
  }));
}
