import type * as Schema from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { createHash, randomUUID } from "node:crypto";

import type { RegulationEntry } from "@/lib/sources/fetch";

const BOOTSTRAP_ENTRIES_PER_SOURCE = 10;

export interface SourceChangeSelection {
  regulations: RegulationEntry[];
  caveats: string[];
  newCount: number;
  changedCount: number;
  baselinedCount: number;
}

function identity(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "").toLowerCase();
}

function fingerprint(entry: RegulationEntry): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        label: entry.label,
        number: entry.number,
        year: entry.year,
        listingTitle: entry.listingTitle,
        fullTitle: entry.fullTitle,
        textUrl: entry.textUrl ?? null,
        effectiveOn: entry.effectiveOn ?? null,
        amendedOn: entry.amendedOn ?? null,
        commentsCloseOn: entry.commentsCloseOn ?? null,
        datesNote: entry.datesNote ?? null,
        documentType: entry.documentType ?? null,
        action: entry.action ?? null,
      }),
    )
    .digest("hex");
}

function revisionUrl(url: string, hash: string): string {
  const parsed = new URL(url);
  parsed.hash = `cante-revision-${hash.slice(0, 12)}`;
  return parsed.toString();
}

/**
 * Persist the complete fetched inventory and return only records that need a
 * verdict. A source's first inventory is a disclosed bootstrap, not hundreds
 * of fabricated "new" changes. Source order is not assumed to be chronological.
 */
export async function selectSourceChanges(
  customerId: string,
  jurisdiction: string,
  entries: RegulationEntry[],
  seenUrls: Array<string | null> = [],
  observedAt = new Date().toISOString(),
): Promise<SourceChangeSelection> {
  const supabase = await createClient();
  const inventory: Array<Record<string, unknown>> = [];
  const seen = new Set(seenUrls.filter((url): url is string => Boolean(url)).map(identity));
  const grouped = new Map<string, RegulationEntry[]>();
  for (const entry of entries) {
    const group = grouped.get(entry.sourceId) ?? [];
    group.push(entry);
    grouped.set(entry.sourceId, group);
  }

  const selected: RegulationEntry[] = [];
  const caveats: string[] = [];
  let newCount = 0;
  let changedCount = 0;
  let baselinedCount = 0;
  const indonesia = jurisdiction === "Indonesia";

  for (const [sourceId, sourceEntries] of grouped) {
    const existingRows = cloudResult<Array<typeof Schema.sourceDocuments.$inferSelect>>(
      await supabase
        .from("source_documents")
        .select("*")
        .eq("customer_id", customerId)
        .eq("jurisdiction", jurisdiction)
        .eq("source_id", sourceId),
    );
    const existing = new Map(existingRows.map((row) => [row.identity, row]));
    const isBootstrap = existingRows.length === 0;
    const bootstrapCandidates: RegulationEntry[] = [];

    for (const entry of sourceEntries) {
      const key = identity(entry.url);
      const hash = fingerprint(entry);
      const prior = existing.get(key);
      if (!prior) {
        inventory.push({
          id: randomUUID(), customer_id: customerId, jurisdiction, source_id: sourceId,
          identity: key, content_hash: hash, first_seen_at: observedAt,
          last_seen_at: observedAt, last_changed_at: observedAt, expected_hash: null,
        });
        if (isBootstrap) {
          if (!seen.has(key)) bootstrapCandidates.push(entry);
        } else {
          selected.push(entry);
          newCount += 1;
        }
        continue;
      }

      const changed = prior.contentHash !== hash;
      inventory.push({
        ...snakeRow(prior), content_hash: hash, last_seen_at: observedAt,
        last_changed_at: changed ? observedAt : prior.lastChangedAt, expected_hash: prior.contentHash,
      });
      if (changed) {
        selected.push({ ...entry, url: revisionUrl(entry.url, hash) });
        changedCount += 1;
      }
    }

    if (isBootstrap) {
      selected.push(...bootstrapCandidates.slice(0, BOOTSTRAP_ENTRIES_PER_SOURCE));
      const baseline = Math.max(0, bootstrapCandidates.length - BOOTSTRAP_ENTRIES_PER_SOURCE);
      baselinedCount += baseline;
      if (baseline > 0) {
        caveats.push(
          indonesia
            ? `${sourceEntries[0]?.sourceName ?? sourceId}: inventaris pertama mencatat ${baseline} entri katalog tambahan sebagai baseline tanpa audit penerapan historis; 10 entri yang belum pernah dilihat masuk ke tahap penilaian. Entri baru atau berubah berikutnya akan dideteksi otomatis.`
            : `${sourceEntries[0]?.sourceName ?? sourceId}: first inventory baselined ${baseline} additional catalogue entries without historical applicability review; 10 unseen entries entered judgment. Future new or changed records are fingerprinted automatically.`,
        );
      } else if (bootstrapCandidates.length > 0) {
        caveats.push(
          indonesia
            ? `${sourceEntries[0]?.sourceName ?? sourceId}: inventaris pertama memiliki ${bootstrapCandidates.length} entri yang belum pernah dilihat dan semuanya masuk penilaian bootstrap. Entri baru atau berubah berikutnya akan dideteksi otomatis.`
            : `${sourceEntries[0]?.sourceName ?? sourceId}: first inventory had ${bootstrapCandidates.length} unseen entries and all entered bootstrap judgment. Future new or changed records are fingerprinted automatically.`,
        );
      }
    }
  }
  if (inventory.length) {
    cloudResult(
      await supabase
        .rpc("record_source_inventory", {
          target_customer_id: customerId, target_jurisdiction: jurisdiction, entries: inventory,
        }),
    );
  }

  return { regulations: selected, caveats, newCount, changedCount, baselinedCount };
}

// Convert SQL column names only; JSON evidence keeps its original keys.
function camelRow<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((row) => camelRow(row)) as T;
  if (!value || typeof value !== "object") return value as T;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), item,
  ])) as T;
}
function snakeRow(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), item,
  ]));
}
function cloudResult<T = unknown>(result: { data?: unknown; error: { message: string; } | null; }): T {
  if (result.error) throw new Error(`Supabase operation failed: ${result.error.message}`);
  return camelRow<T>(result.data);
}
