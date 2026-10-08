import { createClient } from "@/lib/supabase/server";
import { easternIsoDate } from "@/lib/tariff/date";

/**
 * Live-data bridge: reads Section 232 rates from the Supabase-backed,
 * confidence-gated auto-ingestion pipeline (scripts/ingest-section232-
 * proclamation.ts + scripts/verify-section232-proposal.ts), instead of a
 * hand-maintained static table that goes stale every time a new
 * proclamation publishes.
 *
 * Only ever reads rows where current_section232_rate() has already
 * resolved status IN ('approved','auto_approved') -- a 'pending'
 * extraction awaiting verification is invisible here by construction
 * (see supabase/migrations/202610071003_section232_confidence_gate.sql).
 * A database/network failure here must never silently fall back to
 * fabricating a rate -- the caller (stack.ts) treats a thrown error or a
 * null result as "unresolved", not "zero duty".
 */

export interface Section232LiveMatch {
  annex: string;
  ratePercent: number;
  ukRatePercent: number | null;
  usContentRatePercent: number | null;
  effectiveDate: string;
  sourceDocumentNumber: string;
  sourceTitle: string;
  sourcePdfUrl: string;
}

interface RawRpcRow {
  annex: string;
  rate_percent: number | string;
  uk_rate_percent: number | string | null;
  us_content_rate_percent: number | string | null;
  effective_date: string;
  source_document_number: string;
  source_title: string;
  source_pdf_url: string;
}

export class Section232LiveLookupError extends Error {}

export function section232TargetDate(effectiveDate: string | undefined, now: Date = new Date()): string {
  return effectiveDate ?? easternIsoDate(now);
}

/**
 * Resolve the current live Section 232 rate for an HTS code, if any
 * approved/auto-approved proclamation annex covers it. Returns null (not
 * an error) when nothing covers this code -- that is a real, quiet
 * result, not a failure. Throws only when the lookup itself could not be
 * performed, so the caller can distinguish "not covered" from "we could
 * not ask".
 */
export async function lookupSection232Live(
  htsCode: string,
  signal?: AbortSignal,
  effectiveDate?: string,
): Promise<Section232LiveMatch | null> {
  const digitsOnly = htsCode.replace(/\D/g, "");
  if (!digitsOnly) return null;

  let client;
  try {
    client = await createClient();
  } catch (error) {
    throw new Section232LiveLookupError(
      `Could not reach the live Section 232 data store: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  const targetDate = section232TargetDate(effectiveDate);
  const query = client.rpc("current_section232_rate", {
    target_hts_prefix: digitsOnly,
    target_effective_date: targetDate,
  });
  if (signal) query.abortSignal(signal);
  const { data, error } = await query;
  if (error) {
    throw new Section232LiveLookupError(`Live Section 232 lookup failed: ${error.message}`);
  }
  const row = (data as RawRpcRow[] | null)?.[0];
  if (!row) return null;
  if (typeof row.effective_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.effective_date)) {
    throw new Section232LiveLookupError("Live Section 232 rule is missing a structured effective date.");
  }

  return {
    annex: row.annex,
    ratePercent: Number(row.rate_percent) / 100,
    ukRatePercent: row.uk_rate_percent === null ? null : Number(row.uk_rate_percent) / 100,
    usContentRatePercent: row.us_content_rate_percent === null ? null : Number(row.us_content_rate_percent) / 100,
    effectiveDate: row.effective_date,
    sourceDocumentNumber: row.source_document_number,
    sourceTitle: row.source_title,
    sourcePdfUrl: row.source_pdf_url,
  };
}
