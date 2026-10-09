import { randomUUID, createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { easternIsoDate } from "./date";
import { summarizeBusinessImpact, type ImpactRow } from "./business-impact";

export function sanitizeImpactFilename(name: string | null) {
  return (name ?? "upload.csv").split(/[\\/]/).pop()!.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 160) || "upload.csv";
}
export async function createImpactRun(customerId: string, input: string, filename: string | null, rows: ImpactRow[]) {
  const client = await createClient();
  const linked: Array<ImpactRow & { id: string; product_id: string | null; supplier_id: string | null }> = new Array(rows.length);
  const matches = new Map<string, Promise<string | null>>();
  function exactMatch(table: "products" | "suppliers", column: "sku" | "name", value: string | null): Promise<string | null> {
    if (value === null) return Promise.resolve(null);
    const key = JSON.stringify([table, value]);
    let pending = matches.get(key);
    if (!pending) {
      pending = (async () => {
        const { data, error } = await client.from(table).select("id").eq("customer_id", customerId).eq(column, value).limit(2);
        if (error) throw new Error("Snapshot linking failed.");
        return data?.length === 1 ? data[0].id as string : null;
      })();
      matches.set(key, pending);
    }
    return pending;
  }
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(5, rows.length) }, async () => {
    while (next < rows.length) {
      const index = next++;
      const row = rows[index];
      const productId = await exactMatch("products", "sku", row.sku);
      const supplierId = await exactMatch("suppliers", "name", row.supplier);
      const reviewed = row.analysis_kind === "historical_entries" && !productId && row.status === "computed"
        ? { ...row, status: "unresolved" as const, direction: "unknown" as const, computed_annual_duty_usd: null, computed_total_rate: null, annual_delta_usd: null, review_reason: "Historical entry SKU is unmatched; catalogue linkage requires review." } : row;
      linked[index] = { ...reviewed, id: randomUUID(), product_id: productId, supplier_id: supplierId };
    }
  }));
  const idempotencyKey = createHash("sha256").update(input).update(JSON.stringify(linked.map(row => ({
    product: row.product_id, supplierId: row.supplier_id, evidence: row.stack_result, status: row.status,
    sku: row.sku, hts: row.hts, origin: row.origin, supplier: row.supplier, value: row.annual_import_value_usd,
    rate: row.current_duty_rate, date: row.evaluation_date, quantity: row.quantity, unit: row.unit,
    qualification: [row.qualification_verified, row.qualification_basis],
    claims: [row.chapter99_codes, row.exclusion_id, row.special_program_claim], entry: [row.entry_id, row.line_number],
  })))).update(rows.some(row => row.analysis_kind !== "historical_entries" && !row.evaluation_date) ? easternIsoDate() : "dated").digest("hex");
  const run = { ...summarizeBusinessImpact(linked), idempotency_key: idempotencyKey, id: randomUUID(), filename: sanitizeImpactFilename(filename), input_sha256: createHash("sha256").update(input).digest("hex") };
  const { data: persistedId, error } = await client.rpc("create_tariff_impact_run", { target_customer_id: customerId, run_data: run, row_data: linked });
  if (error) throw new Error("Snapshot persistence failed.");
  const persisted = await getImpactRun(customerId, typeof persistedId === "string" ? persistedId : run.id);
  if (!persisted || run.analysis_kind === "historical_entries" && persisted.analysis_kind !== "historical_entries") throw new Error("Historical snapshot schema is not installed.");
  return persisted;
}
export async function listImpactRuns(customerId: string) {
  const client = await createClient();
  const { data, error } = await client.from("tariff_impact_runs").select("*").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error("Snapshot read failed.");
  return data;
}
export async function getImpactRun(customerId: string, runId: string, suppliedClient?: Awaited<ReturnType<typeof createClient>>) {
  const client = suppliedClient ?? await createClient();
  const { data: run, error } = await client.from("tariff_impact_runs").select("*").eq("customer_id", customerId).eq("id", runId).maybeSingle();
  if (error) throw new Error("Snapshot read failed.");
  if (!run) return null;
  const { data: rows, error: rowError } = await client.from("tariff_impact_rows").select("*").eq("customer_id", customerId).eq("run_id", runId).order("row_number");
  if (rowError) throw new Error("Snapshot read failed.");
  return { ...run, rows: rows as ImpactRow[] };
}
