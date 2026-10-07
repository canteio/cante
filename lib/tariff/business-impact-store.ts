import { randomUUID, createHash } from "node:crypto";
import { createRequestClient as createClient } from "@/lib/supabase/server";
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
      linked[index] = { ...row, id: randomUUID(), product_id: productId, supplier_id: supplierId };
    }
  }));
  const run = { ...summarizeBusinessImpact(rows), id: randomUUID(), filename: sanitizeImpactFilename(filename), input_sha256: createHash("sha256").update(input).digest("hex") };
  const { error } = await client.rpc("create_tariff_impact_run", { target_customer_id: customerId, run_data: run, row_data: linked });
  if (error) throw new Error("Snapshot persistence failed.");
  const persisted = await getImpactRun(customerId, run.id);
  if (!persisted) throw new Error("Snapshot read failed.");
  return persisted;
}
export async function listImpactRuns(customerId: string) {
  const client = await createClient();
  const { data, error } = await client.from("tariff_impact_runs").select("*").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error("Snapshot read failed.");
  return data;
}
export async function getImpactRun(customerId: string, runId: string) {
  const client = await createClient();
  const { data: run, error } = await client.from("tariff_impact_runs").select("*").eq("customer_id", customerId).eq("id", runId).maybeSingle();
  if (error) throw new Error("Snapshot read failed.");
  if (!run) return null;
  const { data: rows, error: rowError } = await client.from("tariff_impact_rows").select("*").eq("customer_id", customerId).eq("run_id", runId).order("row_number");
  if (rowError) throw new Error("Snapshot read failed.");
  return { ...run, rows: rows as ImpactRow[] };
}
