import { gunzipSync } from "node:zlib";
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
    qualification: [row.qualification_verified, row.qualification_basis, row.usmca_qualification],
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

// Live-check bookkeeping is separate from immutable historical entry audits.
// It is never a source of approved rates for the calculator.
export type CheckArchiveEvent = { id: string; kind: "completed" | "failed" | "review"; created_at: string; actor_id: string; payload_text: string; payload_sha256: string };
export type CheckArchiveRecord = { id: string; filename: string; created_at: string; actor_id: string; input_csv: string; input_sha256: string; confirmations: Record<string, boolean>; engine: Record<string, unknown> };
export async function beginLiveCheckArchive(client: Awaited<ReturnType<typeof createClient>>, customerId: string, input: string, filename: string | null, confirmations: Record<string, boolean>, engine: Record<string, unknown>) {
  const id = randomUUID();
  const { error } = await client.from("tariff_check_records").insert({ id, customer_id: customerId, filename: sanitizeImpactFilename(filename), input_csv: input, confirmations, engine });
  if (error) throw new Error("Could not save the original check inputs. No check was run.");
  return id;
}
export async function finishLiveCheckArchive(client: Awaited<ReturnType<typeof createClient>>, customerId: string, checkId: string, result: import("@/app/api/tariff/live-check/check").LiveCheckResult) {
  const { sources, ...report } = result;
  const { data, error } = await client.rpc("complete_tariff_check", { target_check_id: checkId, target_customer_id: customerId, report_text: JSON.stringify(report), sources });
  if (error || typeof data !== "string") throw new Error("The calculation could not be archived. Its inputs remain in history as incomplete; no saved result is claimed.");
  return data;
}
export async function failLiveCheckArchive(client: Awaited<ReturnType<typeof createClient>>, customerId: string, checkId: string, error: string, sources: import("@/app/api/tariff/live-check/check").LiveSource[] = []) {
  const { error: failure } = await client.rpc("complete_tariff_check", {target_check_id:checkId,target_customer_id:customerId,report_text:JSON.stringify({error}),sources,outcome:"failed"});
  if (failure) throw new Error("The check failed and its final status could not be saved. Its original inputs remain in history as incomplete.");
}
export async function readLiveCheckArchive(client: Awaited<ReturnType<typeof createClient>>, customerId: string, id: string, includeEvidence = false) {
  const { data: record, error } = await client.from("tariff_check_records").select("*").eq("customer_id",customerId).eq("id",id).maybeSingle();
  if (error) throw new Error("Could not read archived check.");
  if (!record) return null;
  const events: CheckArchiveEvent[]=[]; let eventBytes=0;
  for(let offset=0;;offset+=250){
    const {data:page,error:eventError}=await client.from("tariff_check_events").select("id,kind,created_at,actor_id,payload_text,payload_sha256").eq("customer_id",customerId).eq("check_id",id).order("created_at").order("id").range(offset,offset+249);
    if(eventError)throw new Error("Could not read check decisions.");
    for(const event of page??[]){eventBytes+=Buffer.byteLength(event.payload_text);events.push(event);}
    if(events.length>10000||eventBytes>32*1024*1024)throw new Error("This check exceeds the single-export size limit. No partial history was returned; contact the workspace owner.");
    if((page?.length??0)<250)break;
  }
  const terminal = events?.find(e => e.kind === "completed" || e.kind === "failed");
  const payload = terminal ? JSON.parse(terminal.payload_text) : null;
  const sources = payload?.sources ?? [];
  if (includeEvidence) {
    const ids = [...new Set<string>(sources.map((s:{versionId?:string})=>s.versionId).filter(Boolean))];
    const versions = new Map<string,{body:string;encoding:string;sha256:string;compression?:string|null;original_sha256?:string|null}>();
    // Fetch one bounded source per response, with at most three requests in flight.
    // A single combined response of many legal PDFs can exceed gateway limits.
    let nextSource=0;
    await Promise.all(Array.from({length:Math.min(3,ids.length)},async()=>{
      while(nextSource<ids.length){const sourceId=ids[nextSource++];
        const {data,error:sourceError}=await client.from("tariff_source_versions").select("id,body,encoding,sha256,compression,original_sha256").eq("customer_id",customerId).in("id",[sourceId]);
        if(sourceError)throw new Error("Could not read archived government evidence.");
        for(const v of data??[])versions.set(v.id,v);
      }
    }));
    for(const s of sources) if(s.versionId) {
      const v=versions.get(s.versionId);if(!v)throw new Error("An archived source version is missing.");
      const hash=createHash("sha256").update(v.encoding==="base64"?Buffer.from(v.body,"base64"):Buffer.from(v.body,"utf8")).digest("hex");
      if(hash!==v.sha256||hash!==s.sha256)throw new Error("Archived source integrity check failed.");
      if(v.compression==="gzip"){
        const original=gunzipSync(Buffer.from(v.body,"base64"),{maxOutputLength:32*1024*1024});
        if(v.original_sha256!==s.originalSha256||createHash("sha256").update(original).digest("hex")!==v.original_sha256)throw new Error("Archived original source integrity check failed.");
      }
      s.body=v.body;s.bodyEncoding=v.encoding;if(v.compression){s.compression=v.compression;s.originalSha256=v.original_sha256;}
    }
  }
  for(const e of events??[])if(createHash("sha256").update(e.payload_text).digest("hex")!==e.payload_sha256)throw new Error("Archived event integrity check failed.");
  if(createHash("sha256").update(record.input_csv).digest("hex")!==record.input_sha256)throw new Error("Archived input integrity check failed.");
  return { record: record as CheckArchiveRecord, events: events as CheckArchiveEvent[], ...(terminal?.kind==="failed"?{sourceEvidence:sources}:{}), result: payload && terminal?.kind === "completed" ? {...payload.report,sources} as import("@/app/api/tariff/live-check/check").LiveCheckResult : null };
}

export function isArchiveId(value:unknown):value is string { return typeof value==="string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
