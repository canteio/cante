import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { sourceDocuments } from "@/lib/db/schema";
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
export function selectSourceChanges(
  customerId: string,
  jurisdiction: string,
  entries: RegulationEntry[],
  seenUrls: Array<string | null> = [],
  observedAt = new Date().toISOString(),
): SourceChangeSelection {
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

  db.transaction(() => {
    for (const [sourceId, sourceEntries] of grouped) {
      const existingRows = db
        .select()
        .from(sourceDocuments)
        .where(
          and(
            eq(sourceDocuments.customerId, customerId),
            eq(sourceDocuments.jurisdiction, jurisdiction),
            eq(sourceDocuments.sourceId, sourceId),
          ),
        )
        .all();
      const existing = new Map(existingRows.map((row) => [row.identity, row]));
      const isBootstrap = existingRows.length === 0;
      const bootstrapCandidates: RegulationEntry[] = [];

      for (const entry of sourceEntries) {
        const key = identity(entry.url);
        const hash = fingerprint(entry);
        const prior = existing.get(key);
        if (!prior) {
          db.insert(sourceDocuments)
            .values({
              id: randomUUID(),
              customerId,
              jurisdiction,
              sourceId,
              identity: key,
              contentHash: hash,
              firstSeenAt: observedAt,
              lastSeenAt: observedAt,
              lastChangedAt: observedAt,
            })
            .run();
          if (isBootstrap) {
            if (!seen.has(key)) bootstrapCandidates.push(entry);
          } else {
            selected.push(entry);
            newCount += 1;
          }
          continue;
        }

        const changed = prior.contentHash !== hash;
        db.update(sourceDocuments)
          .set({
            contentHash: hash,
            lastSeenAt: observedAt,
            ...(changed ? { lastChangedAt: observedAt } : {}),
          })
          .where(eq(sourceDocuments.id, prior.id))
          .run();
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
  });

  return { regulations: selected, caveats, newCount, changedCount, baselinedCount };
}
