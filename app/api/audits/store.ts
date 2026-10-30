import { createHash, randomUUID } from "node:crypto";
import { createRequestClient } from "@/lib/supabase/server";
import { readOriginalUpload } from "@/app/api/files/upload-store";
import { createImpactRun } from "@/lib/tariff/business-impact-store";
import type { ImpactRow } from "@/lib/tariff/business-impact";
import { parseAudit, auditTable, suggestMapping, validateMapping } from "./input";
import { AUDIT_VERSION, READABLE_AUDIT_VERSIONS, optionsSchema, factDecisionSchema, type AuditEntry, type AuditResult, type AuditOptions, type Mapping, type FactDecision, type RuleBundle } from "./model";
import { summarizeAudit } from "./engine";
import { isStrictIsoDate } from "@/lib/tariff/date";
import { selectReferenceIds } from "@/app/api/tariff/references/store";
import {auditBlockers} from './readiness';

export const stable = (value:unknown):string => JSON.stringify(value,(_k,v)=>v&&typeof v==="object"&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export const sha = (value:string|Uint8Array) => createHash("sha256").update(value).digest("hex");
export type Db = Awaited<ReturnType<typeof createRequestClient>>;
/** A lost checkpoint response may follow a committed write. Repeat only the
 * identical, tenant/revision/lease-scoped write once; never repeat calculations,
 * claims, approvals or the final commit. Authorization/validation failures and
 * changed inputs are not transient. The original worker deadline still applies. */
export async function saveAuditCheckpoint(db:Db,target:{id:string;customerId:string;revision:number;leaseToken:string},input:{checkpoint:{entry:AuditEntry;result:AuditResult}[];progress:number;input_hash:string},signal:AbortSignal,onRetry?:()=>void){
 for(let attempt=0;attempt<2;attempt++){
  signal.throwIfAborted();
  const saved=await db.from('audit_batches').update(input).eq('id',target.id).eq('customer_id',target.customerId).eq('revision',target.revision).eq('lease_token',target.leaseToken).eq('status','analyzing').select('id').abortSignal(signal).maybeSingle().retry(false);
  if(!saved.error){if(!saved.data)throw Error('Audit inputs or execution lease changed during calculation.');return;}
  const transient=!saved.error.code&&(saved.status===0||saved.status>=500&&saved.status<600);
  if(attempt===0&&transient&&!signal.aborted){onRetry?.();continue;}
  console.error('Historical audit checkpoint transport',{status:saved.status,code:saved.error.code,message:saved.error.message.slice(0,512)});
  throw Error('Audit checkpoint could not be saved (HTTP '+saved.status+', '+(saved.error.code||'transport')+').');
 }
}
export async function auditOriginal(customerId:string,uploadId:string){const original=await readOriginalUpload(customerId,uploadId,2*1024*1024);if(!/\.csv$/i.test(original.file.filename))throw Error("Historical audits accept CSV files up to 2 MiB.");const csv=new TextDecoder("utf-8",{fatal:true}).decode(original.bytes);return {...original,csv};}
export async function previewAudit(customerId:string,input:{uploadId:string;mapping?:unknown;options?:unknown}) {
  const original=await auditOriginal(customerId,input.uploadId);const table=auditTable(original.csv);
  const mapping=input.mapping===undefined?suggestMapping(table.headers):validateMapping(table.headers,input.mapping);
  const options=optionsSchema.parse(input.options);const entries=parseAudit(original.csv,mapping,options);
  const db=await createRequestClient();const links=await catalogueLinks(db,customerId,entries);
  return {headers:table.headers,mapping,entries:entries.map(e=>({...e,productId:links[e.sku]?.id??null})),filename:original.file.filename,valid:entries.filter(e=>!e.errors.length).length};
}
export async function catalogueLinks(db:Db,customerId:string,entries:AuditEntry[]){
  const links:Record<string,{id:string;origin:string|null}>=Object.create(null);const skus=[...new Set(entries.map(e=>e.sku).filter(Boolean))];
  for(let start=0;start<skus.length;start+=100){const {data,error}=await db.from("products").select("id,sku,origin_country").eq("customer_id",customerId).in("sku",skus.slice(start,start+100));if(error)throw Error("Catalogue matching is unavailable.");for(const p of data??[])links[p.sku]={id:p.id,origin:p.origin_country};}
  return links;
}
/** Confirmed import identifiers create minimal inactive catalogue links only.
 * Existing products, current origin/classification/value and monitor scope stay
 * untouched. ON CONFLICT DO NOTHING also handles concurrent uploads safely. */
export async function ensureAuditProductLinks(db:Db,customerId:string,entries:AuditEntry[],uploadId:string){
 const existing=await catalogueLinks(db,customerId,entries),bySku=new Map<string,AuditEntry[]>();for(const e of entries){if(!e.sku||existing[e.sku])continue;bySku.set(e.sku,[...(bySku.get(e.sku)??[]),e]);}
 const rows=[...bySku].map(([sku,lines])=>{const descriptions=[...new Set(lines.map(e=>e.description).filter(Boolean))];return {id:randomUUID(),customer_id:customerId,sku,name:descriptions.length===1?descriptions[0].slice(0,250):sku,description:descriptions.length===1?descriptions[0]:null,origin_country:null,unit_of_measure:null,unit_value:null,active:false,notes:`Historical audit association from retained upload ${uploadId}. Current origin, classification and value have not been established.`};});
 for(let i=0;i<rows.length;i+=100){const {error}=await db.from('products').upsert(rows.slice(i,i+100),{onConflict:'customer_id,sku',ignoreDuplicates:true});if(error)throw Error('Audit product associations could not be saved. The original file is retained; retry without changing the data.');}
 return rows.length;
}
export async function reviewedCatalogueLinks(db:Db,customerId:string,entries:AuditEntry[],decisions:FactDecision[]){
  const bySku=await catalogueLinks(db,customerId,entries);const selected=decisions.filter(d=>d.kind==="confirm_facts"&&d.productId&&d.evidence.length&&d.validFrom&&d.validBefore);const ids=[...new Set(selected.map(d=>d.productId!))];const products=new Map<string,{id:string;origin_country:string|null}>();
  for(let i=0;i<ids.length;i+=100){const {data,error}=await db.from("products").select("id,origin_country").eq("customer_id",customerId).in("id",ids.slice(i,i+100));if(error)throw Error("Reviewed product links could not be checked.");for(const p of data??[])products.set(p.id,p);}
  return entries.map(e=>{const decision=selected.filter(d=>d.row===e.row&&d.validFrom!<=e.date&&e.date<d.validBefore!).at(-1);if(decision){const p=products.get(decision.productId!);return p?{id:p.id,origin:p.origin_country}:null;}return bySku[e.sku]??null;});
}
export async function readDecisions(db:Db,customerId:string,auditId:string):Promise<FactDecision[]> {
  const all:FactDecision[]=[];for(let offset=0;;offset+=250){const {data,error}=await db.from("audit_review_events").select("id,actor_id,created_at,revision,decision").eq("customer_id",customerId).eq("audit_id",auditId).order("created_at").order("id").range(offset,offset+249);if(error)throw Error("Audit review history is unavailable.");for(const d of data??[])all.push({...factDecisionSchema.parse(d.decision),id:d.id,actor_id:d.actor_id,created_at:d.created_at,revision:d.revision});if(all.length>2000)throw Error("Audit review history exceeds the bounded review limit.");if((data?.length??0)<250)return all;}
}
/** Source lookup follows dated, evidence-backed corrections while preserving the original entry. */
export function referenceEntries(entries:AuditEntry[],decisions:FactDecision[]){
 return entries.map(entry=>{
  let hts=entry.hts,origin=entry.origin,exclusion=entry.exclusion;
  for(const d of decisions)if(d.row===entry.row&&d.kind==="confirm_facts"&&d.hts&&d.facts?.classification_verified===true&&d.evidence.length&&d.validFrom&&d.validBefore&&isStrictIsoDate(d.validFrom)&&isStrictIsoDate(d.validBefore)&&d.validFrom<=entry.date&&entry.date<d.validBefore)hts=d.hts;
  for(const d of decisions)if(d.row===entry.row&&d.kind==="confirm_facts"&&d.origin&&d.facts?.origin_verified===true&&d.evidence.length&&d.validFrom&&d.validBefore&&isStrictIsoDate(d.validFrom)&&isStrictIsoDate(d.validBefore)&&d.validFrom<=entry.date&&entry.date<d.validBefore)origin=d.origin;
  for(const d of decisions)if(d.row===entry.row&&d.kind==="confirm_facts"&&d.exclusion&&d.facts?.exclusion_qualified===true&&d.evidence.length&&d.validFrom&&d.validBefore&&isStrictIsoDate(d.validFrom)&&isStrictIsoDate(d.validBefore)&&d.validFrom<=entry.date&&entry.date<d.validBefore)exclusion=d.exclusion;
  const shipment=decisions.filter(d=>d.row===entry.row&&d.kind==="confirm_facts"&&d.shipment&&d.evidence.length&&d.validFrom&&d.validBefore&&isStrictIsoDate(d.validFrom)&&isStrictIsoDate(d.validBefore)&&d.validFrom<=entry.date&&entry.date<d.validBefore).reduce((current,d)=>({...current,...d.shipment}),{...entry.shipment});
  return {date:entry.date,hts,origin,value:entry.value,quantity:entry.quantity,unit:entry.unit,...(Object.keys(shipment).length?{shipment}:{}),...(entry.chapter99.length?{chapter99:entry.chapter99}:{}),...(exclusion?{exclusion}:{})};
 });
}
export async function approvedBundleIds(db:Db,entries:{hts:string;origin:string;date:string}[]):Promise<string[]>{
 const scopes=entries.filter(e=>/^\d{10}$/.test(e.hts)&&/^[A-Z]{2}$/.test(e.origin)&&isStrictIsoDate(e.date)).map(({hts,origin,date})=>({hts,origin,date}));
 if(!scopes.length)return [];
 const {data,error}=await db.rpc("select_historical_rule_bundles",{scopes});
 if(error)throw Error("Historical rule coverage is unavailable. Apply the Audits migrations first.");
 if((data?.length??0)>100)throw Error("This audit spans too many rule versions. Split its date range or consolidate overlapping coverage.");
 return(data??[]).map((b:{id:string})=>b.id);
}
export async function approvedBundles(db:Db,ids?:string[]):Promise<RuleBundle[]>{
  if(ids?.length===0)return [];const bundles:RuleBundle[]=[];
  let retained=0;for(let offset=0;;offset++){let q=db.from("tariff_rule_bundles").select("id,definition,sources,status,approved_by,approved_at").eq("status","approved").order("created_at").order("id").range(offset,offset);if(ids)q=q.in("id",ids);const {data,error}=await q;if(error)throw Error("Historical rule coverage is unavailable. Install the Audits migration before checking.");for(const b of data??[]){retained+=Buffer.byteLength(JSON.stringify(b));if(retained>24*1024*1024)throw Error("Historical evidence exceeds this audit's 24 MiB execution budget. A reviewer must narrow or consolidate coverage.");bundles.push(b as RuleBundle);}if(bundles.length>100)throw Error("Historical rule selection exceeds its limit; a reviewer must consolidate coverage.");if(!(data?.length??0))break;}
  if(ids&&bundles.length!==ids.length)throw Error("A pinned approved historical rule snapshot is unavailable.");return bundles;
}
function inputRow(e:AuditEntry):ImpactRow { return {analysis_kind:"historical_entries",input_valid:!e.errors.length,row_number:e.row,entry_id:e.entry||null,line_number:e.line||null,sku:e.sku||null,hts:e.hts||null,origin:e.origin||null,supplier:e.supplier||null,customs_value_usd:e.value===null?null:Number(e.value),paid_duty_usd:e.paid===null?null:Number(e.paid),annual_import_value_usd:e.value===null?null:Number(e.value),current_duty_rate:e.value!==null&&Number(e.value)>0&&e.paid!==null?Number(e.paid)/Number(e.value):0,evaluation_date:/^\d{4}-\d{2}-\d{2}$/.test(e.date)&&!e.errors.some(s=>s.startsWith("Entry date"))?e.date:null,quantity:e.quantity===null?null:Number(e.quantity),unit:e.unit||null,chapter99_codes:e.chapter99.join(";")||null,exclusion_id:e.exclusion||null,special_program_claim:null,status:e.errors.length?"error":"unresolved",direction:"unknown",current_annual_duty_usd:e.paid===null?null:Number(e.paid),computed_annual_duty_usd:null,computed_total_rate:null,annual_delta_usd:null,stack_result:null,raw_input:e.raw,error:e.errors.length?e.errors.join(" "):null}; }
export async function createAudit(customerId:string,input:{uploadId:string;mapping:Mapping;options:AuditOptions}){
  const original=await auditOriginal(customerId,input.uploadId);const options=optionsSchema.parse(input.options);const mapping=validateMapping(auditTable(original.csv).headers,input.mapping);const entries=parseAudit(original.csv,mapping,options);const db=await createRequestClient();const bundleIds=await approvedBundleIds(db,entries);const referenceIds=await selectReferenceIds(db,entries);
  const key=sha(stable({original:original.file.sha256,mapping,options,bundleIds,referenceIds,version:AUDIT_VERSION}));
  const previous=await db.from("audit_batches").select("id").eq("customer_id",customerId).eq("idempotency_key",key).maybeSingle();if(previous.error)throw Error("Audit storage is unavailable.");if(previous.data)return previous.data.id;
  if(options.saveMissingProducts)await ensureAuditProductLinks(db,customerId,entries,input.uploadId);
  const snapshot=await createImpactRun(customerId,original.csv,original.file.filename,entries.map(inputRow));
  const id=randomUUID();const {error}=await db.from("audit_batches").insert({id,customer_id:customerId,filename:original.file.filename,upload_id:input.uploadId,input_run_id:snapshot.id,mapping,options,bundle_ids:bundleIds,reference_ids:referenceIds,idempotency_key:key});
  if(error){const duplicate=await db.from("audit_batches").select("id").eq("customer_id",customerId).eq("idempotency_key",key).maybeSingle();if(duplicate.data)return duplicate.data.id;throw Error("The original input is saved, but the audit could not be created.");}return id;
}
export async function readAudit(db:Db,customerId:string,id:string,runId?:string){
  const {data:batch,error}=await db.from("audit_batches").select("id,customer_id,filename,upload_id,input_run_id,mapping,options,bundle_ids,reference_ids,revision,status,active_run_id,progress,summary,last_error,lease_until,created_at").eq("customer_id",customerId).eq("id",id).maybeSingle();if(error)throw Error("Audit storage is unavailable. Apply the Audits migration before using this page.");if(!batch)return null;
  const decisions=await readDecisions(db,customerId,id);const {data:history,error:he}=await db.from("tariff_impact_attestations").select("run_id,revision,verified_at,summary").eq("customer_id",customerId).eq("audit_id",id).order("verified_at",{ascending:false}).limit(50);if(he)throw Error("Audit verification history is unavailable.");
  const selected=runId??(batch.status==="completed"?batch.active_run_id:null);let engineVersion=AUDIT_VERSION;let verified=false;let resultRevision:number|null=null;let rows:{entry:AuditEntry;result:AuditResult}[]=[];
  if(selected){const {data:proof,error:pe}=await db.from("tariff_impact_attestations").select("*").eq("customer_id",customerId).eq("audit_id",id).eq("run_id",selected).maybeSingle();if(pe||!proof)throw Error("A protected execution proof is unavailable; calculated totals are withheld.");const {data:records,error:re}=await db.from("audit_entry_results").select("row_number,result_text,result_sha256").eq("customer_id",customerId).eq("audit_id",id).eq("run_id",selected).order("row_number").limit(501);if(re||!records?.length||records.length>500||records.some((r,i)=>r.row_number!==i+1||sha(r.result_text)!==r.result_sha256)||sha(records.map(r=>r.result_text).join("\n"))!==proof.result_sha256||!READABLE_AUDIT_VERSIONS.includes(proof.engine_version))throw Error("Audit execution integrity could not be verified; totals are withheld.");rows=records.map(r=>JSON.parse(r.result_text));if(stable(summarizeAudit(rows.map(r=>r.result)))!==stable(proof.summary))throw Error("Audit summary integrity check failed.");verified=true;engineVersion=proof.engine_version;resultRevision=proof.revision;}
  return {batch,decisions,history:history??[],rows,verified,engineVersion,resultRevision,stale:!!selected&&resultRevision!==batch.revision,summary:verified?summarizeAudit(rows.map(r=>r.result)):null};
}
export function exportAudit(data:Pick<NonNullable<Awaited<ReturnType<typeof readAudit>>>,"rows"|"decisions"|"verified"|"resultRevision"> & {batch:{id:string};engineVersion?:string}){
  if(!data.verified)throw Error("Run and verify this audit before exporting calculated results.");
  const cell=(v:unknown)=>{let s=v==null?"":typeof v==="object"?JSON.stringify(v):String(v);if(typeof v==="string"&&/^[\s\u0000-\u001f]*[=+\-@]/.test(s)&&!/^-[0-9]+(?:\.[0-9]{1,2})?$/.test(s))s="'"+s;return `"${s.replace(/"/g,'""')}"`;};
  const headers=["entry_number","entry_line","entry_date","sku","description","declared_hts","declared_origin","supplier","customs_value_usd","paid_duty_usd","expected_duty_usd","paid_minus_expected_usd","calculation_basis","calculation_hts","calculation_origin","facts_used","findings","missing_evidence","next_step","components_and_citations","rule_bundle_id","review_status","review_events","original_input_json","historical_reference","validation","engine_version","audit_id","limitation","calculation_blockers","chapter99_treatment","calculation_exclusion","exclusion_product_definition","payment_stage","component_reporting","tariff_column"];
  return [headers,...data.rows.map(({entry:e,result:r})=>{const events=data.decisions.filter(d=>d.row===e.row&&(data.resultRevision===null||(d.revision??0)<=data.resultRevision));const review=events.filter(d=>d.revision===data.resultRevision&&(d.kind==="reviewed"||d.kind==="resolved")).at(-1);return [e.entry,e.line,e.date,e.sku,e.description,e.hts,e.origin,e.supplier,e.value,e.paid,r.expected,r.difference,r.basis,r.appliedHts,r.appliedOrigin,r.factsUsed,r.findings,[...new Set(r.findings.flatMap(f=>f.missing))],r.findings.map(f=>f.next),r.components.map(c=>{if(r.validation?.kind!=="cante_validated")return c;const {effectiveFrom,effectiveBefore,...component}=c;return {...component,referenceEdition:r.reference?.release?.name??null,entryDate:e.date,calculationCoverageFrom:effectiveFrom,calculationCoverageBefore:effectiveBefore,limitation:"Calculation coverage interval; publication dates do not establish original legal effective dates or expiration."};}),r.bundleId,review?.kind??(r.findings.length?"review_required":"math_checked"),events,e.raw,r.reference??null,r.validation??null,data.engineVersion??AUDIT_VERSION,data.batch.id,"Potential duty discrepancies, not guaranteed refunds or legal conclusions. Unsupported scope remains unresolved.",auditBlockers(r),r.chapter99??null,r.appliedExclusion??null,r.appliedExclusionScope??null,r.paymentStage??null,r.componentReporting??null,r.tariffColumn??null];})].map(row=>row.map(cell).join(",")).join("\r\n")+"\r\n";
}
