import { createHash } from "node:crypto";
import { getAuthenticatedWorkspace,createRequestClient,isPlatformTariffReviewer } from "@/lib/supabase/server";
import { withRequestLimit } from "@/app/api/request-limits";
import { bundleSchema,type BundleSource } from "../model";
import { validateBundle } from "../engine";
import { prepareReferenceDraft } from "../preparation";
import { selectReferenceIds,loadAuditReferences } from "@/app/api/tariff/references/store";
import { readReferenceBytes } from "@/app/api/tariff/references/store";
export const runtime="nodejs";export const maxDuration=150;
export async function GET(){const ws=await getAuthenticatedWorkspace();if(!ws)return Response.json({error:"Authentication required."},{status:401});const reviewer=await isPlatformTariffReviewer();const {data,error}=await(await createRequestClient()).from("tariff_rule_bundles").select("id,title:definition->>title,status,approved_by,approved_at,review_note,created_at").order("created_at",{ascending:false}).limit(100);return error?Response.json({error:"Historical rule storage is unavailable."},{status:503}):Response.json({bundles:(data??[]).map(b=>({...b,definition:{title:b.title}})),reviewer});}
export async function POST(request:Request){return withRequestLimit(request,"check",1100000,async request=>{
  const ws=await getAuthenticatedWorkspace();if(!ws)return Response.json({error:"Authentication required."},{status:401});if(!await isPlatformTariffReviewer())return Response.json({error:"Platform tariff reviewer access required."},{status:403});
  try{const input=await request.json();const db=await createRequestClient();
    if(input.action==="prepare_reference_draft"){
      const entries=[{hts:String(input.hts??""),date:String(input.from??"")}];
      if(!/^\d{10}$/.test(entries[0].hts)||!/^\d{4}-\d{2}-\d{2}$/.test(entries[0].date))throw Error("Supply an exact code and historical date.");
      const ids=await selectReferenceIds(db,entries),[reference]=await loadAuditReferences(db,entries,ids);return Response.json(prepareReferenceDraft(reference,{hts:entries[0].hts,origin:String(input.origin??""),from:entries[0].date,before:String(input.before??""),column:input.column}));
    }
    if(input.action==="review"){if(!/^[a-f0-9-]{36}$/.test(input.id)||!["approved","rejected"].includes(input.decision)||typeof input.note!=="string"||input.note.trim().length<10||input.sourceRead!==true)throw Error("Read the sources and record the legal basis for this decision.");const {error}=await db.rpc("review_historical_bundle",{bundle_id:input.id,decision:input.decision,note:input.note,source_read:true});if(error)throw Error("The bundle could not be reviewed. Approved versions cannot be edited or approved again.");return Response.json({saved:true});}
    const definition=bundleSchema.parse(input.definition);if(definition.synthetic)throw Error("Synthetic tariff rules are restricted to isolated functionality tests.");
    if(!Array.isArray(input.sources)||!input.sources.length||input.sources.length>20)throw Error("Supply 1–20 official source references.");
    const sources:BundleSource[]=[];let total=0;
    for(const source of input.sources){if(typeof source.id!=="string"||!source.id.trim()||source.id.length>80||sources.some(s=>s.id===source.id))throw Error("Each source needs a unique identity.");if(typeof source.referenceId==="string"){
      if(!/^[a-f0-9-]{36}$/.test(source.referenceId))throw Error("Select a retained official reference.");
      const {source:retained,bytes}=await readReferenceBytes(db,source.referenceId);if(!["hts_json","chapter99_pdf","legal_document"].includes(retained.kind))throw Error("Legacy observations and release dates are not approved legal-source evidence.");
      sources.push({id:source.id,referenceId:retained.id,url:retained.url,title:retained.title,body:"",encoding:bytes.subarray(0,5).equals(Buffer.from("%PDF-"))?"base64":"utf8",sha256:retained.original_sha256,capturedAt:retained.captured_at});continue;
    }const url=new URL(source.url);const government=url.hostname.endsWith(".gov"),csms=url.hostname==="content.govdelivery.com"&&url.pathname.startsWith("/accounts/USDHSCBP/");if(url.protocol!=="https:"||url.username||url.password||url.port||!government&&!csms)throw Error("Only HTTPS government or official CBP CSMS sources are accepted.");const response=await fetch(url,{redirect:"error",cache:"no-store",signal:AbortSignal.any([request.signal,AbortSignal.timeout(25000)])});if(!response.ok||!response.body)throw Error("An official source could not be captured; no draft was saved.");const chunks:Uint8Array[]=[];let bytes=0;const reader=response.body.getReader();try{while(true){const p=await reader.read();if(p.done)break;bytes+=p.value.length;if(bytes>4*1024*1024)throw Error("An official source exceeds the 4 MiB capture limit.");chunks.push(p.value);}}finally{await reader.cancel().catch(()=>{});}const body=Buffer.concat(chunks);const binary=body.subarray(0,5).equals(Buffer.from("%PDF-"));const retained=binary?body.toString("base64"):new TextDecoder("utf-8",{fatal:true}).decode(body);total+=Buffer.byteLength(retained);if(total>10*1024*1024)throw Error("The rule bundle exceeds its source retention budget.");sources.push({id:source.id,url:url.toString(),title:typeof source.title==="string"?source.title.slice(0,200):url.hostname,body:retained,encoding:binary?"base64":"utf8",sha256:createHash("sha256").update(body).digest("hex"),capturedAt:new Date().toISOString()});}
    validateBundle({id:"draft",definition,sources,status:"approved",approved_by:ws.userId,approved_at:new Date().toISOString()});
    const {data,error}=await db.from("tariff_rule_bundles").insert({definition,sources}).select("id").single();if(error)throw Error("The historical draft could not be saved.");return Response.json({id:data.id},{status:201});
  }catch(e){return Response.json({error:e instanceof Error?e.message:"Unable to save historical rule snapshot."},{status:400});}
});}
