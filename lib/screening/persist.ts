import type * as Schema from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { randomUUID } from "node:crypto";

import { type ScreeningResultRow } from "@/lib/db/schema";
import { CslUpstreamError, screenExactNames } from "@/lib/screening/csl";

/**
 * Screening persistence — the missing half of item 10.
 *
 * `lib/screening/csl.ts` answers "is this name on the consolidated list right
 * now". This makes each answer an auditable event, because a clean screen is
 * worth nothing without a date attached — the question is always "were they
 * clear *when we shipped*", not "are they clear today".
 *
 * `outcome: "error"` is a first-class value. An upstream failure must never be
 * stored or rendered as `clear`; that is the single way a screening feature
 * turns into a liability.
 *
 * Scope, stated plainly: this covers restricted-party screening against one
 * official US list. It is not export-licence determination, and it is not ECCN
 * classification. Those need datasets and legal logic this project does not
 * have, and pretending otherwise would be worse than the gap.
 */

export interface ScreenSupplierResult {
  row: ScreeningResultRow;
  /** True only when the upstream call succeeded and returned no match. */
  clear: boolean;
}

export async function screenSupplier(
  customerId: string,
  supplierId: string,
): Promise<ScreenSupplierResult> {
  const supabase = await createClient();
  const supplier = (cloudResult<typeof Schema.suppliers.$inferSelect | null>(
    await supabase
      .from("suppliers")
      .select("*")
      .eq("id", supplierId)
      .limit(1)
      .maybeSingle(),
  ) ?? undefined);
  if (!supplier) throw new Error("Supplier not found.");
  return await screenName(customerId, supplier.name, supplierId);
}

export async function screenName(
  customerId: string,
  name: string,
  supplierId: string | null = null,
): Promise<ScreenSupplierResult> {
  const supabase = await createClient();
  const now = new Date().toISOString();
  const base = {
    id: randomUUID(),
    customerId,
    supplierId,
    screenedName: name,
    provider: "csl",
    screenedAt: now,
  };

  try {
    const result = await screenExactNames({ names: [name] });
    const matches = result.matches.map((m) => ({
      name: m.matchedName,
      source: m.sourceList,
      url: m.sourceUrl,
      addresses: m.addresses.map((a) =>
        [a.address, a.city, a.country].filter(Boolean).join(", "),
      ),
    }));

    const row = {
      ...base,
      outcome: matches.length > 0 ? "match" : "clear",
      matchCount: matches.length,
      matches,
      errorMessage: null,
      listVersion: result.fetchedAt,
    };
    cloudResult(
      await supabase
        .from("screening_results")
        .insert(snakeRow(row)),
    );
    return { row: row as ScreeningResultRow, clear: matches.length === 0 };
  } catch (error) {
    const message =
      error instanceof CslUpstreamError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Screening failed.";
    const row = {
      ...base,
      outcome: "error",
      matchCount: 0,
      matches: [],
      errorMessage: message,
      listVersion: null,
    };
    cloudResult(
      await supabase
        .from("screening_results")
        .insert(snakeRow(row)),
    );
    // Deliberately not `clear`. A failed screen is an unscreened party.
    return { row: row as ScreeningResultRow, clear: false };
  }
}

/** Screen every active supplier. Failures are recorded, not thrown away. */
export async function screenAllSuppliers(customerId: string): Promise<{
  screened: number;
  matched: number;
  errored: number;
  results: ScreeningResultRow[];
}> {
  const supabase = await createClient();
  const rows = cloudResult<Array<typeof Schema.suppliers.$inferSelect>>(
    await supabase
      .from("suppliers")
      .select("*")
      .eq("customer_id", customerId),
  );
  const results: ScreeningResultRow[] = [];
  let matched = 0;
  let errored = 0;

  for (const supplier of rows) {
    const { row } = await screenName(customerId, supplier.name, supplier.id);
    results.push(row);
    if (row.outcome === "match") matched += 1;
    if (row.outcome === "error") errored += 1;
  }

  return { screened: rows.length, matched, errored, results };
}

export async function latestScreening(supplierId: string): Promise<ScreeningResultRow | undefined> {
  const supabase = await createClient();
  return (cloudResult<typeof Schema.screeningResults.$inferSelect | null>(
    await supabase
      .from("screening_results")
      .select("*")
      .eq("supplier_id", supplierId)
      .order("screened_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ) ?? undefined);
}

export async function screeningHistory(customerId: string): Promise<ScreeningResultRow[]> {
  const supabase = await createClient();
  return cloudResult<Array<typeof Schema.screeningResults.$inferSelect>>(
    await supabase
      .from("screening_results")
      .select("*")
      .eq("customer_id", customerId)
      .order("screened_at", { ascending: false }),
  );
}

export interface ScreeningCoverage {
  totalSuppliers: number;
  neverScreened: string[];
  staleScreenings: Array<{ name: string; screenedAt: string; ageDays: number; }>;
  currentMatches: Array<{ name: string; matchCount: number; }>;
  erroredScreenings: string[];
}

/**
 * Who is and is not covered. The point of this function is `neverScreened` —
 * a screening feature that only reports on parties it has looked at tells you
 * nothing about the ones it has not.
 */
export async function screeningCoverage(
  customerId: string,
  options: { now?: Date; staleAfterDays?: number; } = {},
): Promise<ScreeningCoverage> {
  const supabase = await createClient();
  const now = options.now ?? new Date();
  const staleAfter = options.staleAfterDays ?? 90;
  const rows = cloudResult<Array<typeof Schema.suppliers.$inferSelect>>(
    await supabase
      .from("suppliers")
      .select("*")
      .eq("customer_id", customerId),
  );

  const coverage: ScreeningCoverage = {
    totalSuppliers: rows.length,
    neverScreened: [],
    staleScreenings: [],
    currentMatches: [],
    erroredScreenings: [],
  };

  for (const supplier of rows) {
    const latest = await latestScreening(supplier.id);
    if (!latest) {
      coverage.neverScreened.push(supplier.name);
      continue;
    }
    if (latest.outcome === "error") {
      coverage.erroredScreenings.push(supplier.name);
      continue;
    }
    if (latest.outcome === "match") {
      coverage.currentMatches.push({ name: supplier.name, matchCount: latest.matchCount });
    }
    const ageDays = Math.round(
      (now.getTime() - new Date(latest.screenedAt).getTime()) / 86_400_000,
    );
    if (ageDays > staleAfter) {
      coverage.staleScreenings.push({ name: supplier.name, screenedAt: latest.screenedAt, ageDays });
    }
  }

  return coverage;
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
