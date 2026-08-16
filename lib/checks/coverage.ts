import type { RegulationEntry } from "@/lib/sources/fetch";

/**
 * Entries in, verdicts out.
 *
 * `source_results` proves what was *fetched*. Nothing proved what was
 * *judged* — an entry the model silently skipped and an entry it read and
 * cleared both left no row, so a run could parse 30 Kemendag entries, return
 * verdicts on none of them, and still read as "checked, nothing found". That
 * is the exact failure rule 2 exists to prevent, one stage further down.
 *
 * Not every entry needs a verdict: anything already in the seen log was
 * deliberately withheld ("do not flag these again"). Those are accounted for
 * separately from entries nobody has ever said anything about.
 */

export interface VerdictCoverage {
  totalEntries: number;
  judged: number;
  alreadySeen: number;
  /** Never judged in this run, and never seen in any earlier run. */
  unaccounted: RegulationEntry[];
  /** Caveats written by code, not by the model. */
  caveats: string[];
}

function key(url: string | null | undefined): string {
  return (url ?? "").trim().replace(/\/+$/, "").toLowerCase();
}

export function auditVerdictCoverage(
  regulations: RegulationEntry[],
  judgedUrls: (string | null)[],
  seenUrls: (string | null)[],
): VerdictCoverage {
  const judged = new Set(judgedUrls.map(key).filter(Boolean));
  const seen = new Set(seenUrls.map(key).filter(Boolean));

  let judgedCount = 0;
  let seenCount = 0;
  const unaccounted: RegulationEntry[] = [];

  for (const entry of regulations) {
    const k = key(entry.url);
    if (judged.has(k)) judgedCount += 1;
    else if (seen.has(k)) seenCount += 1;
    else unaccounted.push(entry);
  }

  const caveats: string[] = [];
  if (unaccounted.length > 0) {
    const examples = unaccounted
      .slice(0, 5)
      .map((e) => e.label || e.fullTitle.slice(0, 60))
      .join("; ");
    caveats.push(
      `${unaccounted.length} dari ${regulations.length} entri yang berhasil diambil tidak ` +
        `mendapat penilaian pada pengecekan ini dan juga belum pernah muncul di run sebelumnya — ` +
        `anggap belum diperiksa, bukan "tidak ada yang relevan"` +
        (examples ? `: ${examples}` : "") +
        (unaccounted.length > 5 ? ", dan lainnya." : "."),
    );
  }

  return {
    totalEntries: regulations.length,
    judged: judgedCount,
    alreadySeen: seenCount,
    unaccounted,
    caveats,
  };
}
