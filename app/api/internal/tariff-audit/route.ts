import {referenceGroupEnd} from "@/app/api/audits/shipment";
import { createHash,timingSafeEqual } from "node:crypto";
import { boundedRequest } from "@/app/api/request-body";
import { createRequestClient,getAuthenticatedWorkspace } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isArchiveId } from "@/lib/tariff/business-impact-store";
import { dispatchSignature } from "@/app/api/tariff/live-check/worker-client";
import { auditOriginal,approvedBundles,reviewedCatalogueLinks,readDecisions,referenceEntries,stable,sha,saveAuditCheckpoint } from "@/app/api/audits/store";
import { loadAuditReferences,readReferenceBytes,referenceExecutionCache } from "@/app/api/tariff/references/store";
import { optionsSchema,AUDIT_VERSION,type AuditEntry,type AuditResult } from "@/app/api/audits/model";
import { parseAudit,validateMapping,auditTable } from "@/app/api/audits/input";
import { evaluateAuditEntry,summarizeAudit,validateBundle } from "@/app/api/audits/engine";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=300;
export async function POST(request:Request){
  if(process.env.CANTE_TRUSTED_CHECK_WORKER!=="true"||process.env.VERCEL&&process.env.CANTE_DEPLOYMENT_ROLE!=="trusted-check-worker")return Response.json({error:"A separate trusted checking worker is required."},{status:409});
  const secret=process.env.CANTE_CHECK_DISPATCH_SECRET;if(!secret||secret.length<32)return Response.json({error:"Worker dispatch is unavailable."},{status:503});
  let body:string;try{body=await(await boundedRequest(request,1024)).text();}catch{return Response.json({error:"Invalid dispatch body."},{status:413});}
  const timestamp=request.headers.get("x-cante-dispatched-at")??"",signature=request.headers.get("x-cante-dispatch-signature")??"";
  const expected=dispatchSignature(secret,timestamp,body,request.headers.get("authorization")??request.headers.get("cookie")??"");
  if(!/^\d{13}$/.test(timestamp)||Math.abs(Date.now()-Number(timestamp))>60000||!/^[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return Response.json({error:"Unauthorized dispatch."},{status:401});
  let input:{task:string;auditId:string;customerId:string;revision:number};try{input=JSON.parse(body);if(input.task!=="historical_audit"||!isArchiveId(input.auditId)||!isArchiveId(input.customerId)||!Number.isInteger(input.revision)||input.revision<0)throw Error();}catch{return Response.json({error:"Invalid audit identity."},{status:400});}
  const db=await createRequestClient(),ws=await getAuthenticatedWorkspace(input.customerId);const auth=await db.auth.getUser();
  if(!ws||auth.error||auth.data.user?.id!==ws.userId||ws.role==="viewer")return Response.json({error:"Audit write access required."},{status:403});
  const owned=await db.from("audit_batches").select("id").eq("customer_id",ws.customerId).eq("id",input.auditId).maybeSingle();if(owned.error||!owned.data)return Response.json({error:"Audit not found."},{status:404});
  const service=createServiceClient();const claim=await service.rpc("claim_historical_audit",{target_audit:input.auditId,target_customer:ws.customerId,expected_revision:input.revision});
  if(claim.error||!claim.data)return Response.json({error:"This audit is complete, has changed, or is already running."},{status:409});
  const batch=claim.data;const signal=AbortSignal.any([request.signal,AbortSignal.timeout(250000)]);let cancelled=false;let stage='initial_sources';
  return new Response(new ReadableStream({async start(controller){const send=(event:unknown)=>{if(!cancelled)controller.enqueue(new TextEncoder().encode(JSON.stringify(event)+"\n"));};try{
    send({type:"progress",message:"Reading the retained original and approved historical rules…"});
    const original=await auditOriginal(ws.customerId,batch.upload_id);const mapping=validateMapping(auditTable(original.csv).headers,batch.mapping),options=optionsSchema.parse(batch.options);const entries=parseAudit(original.csv,mapping,options);
    let retainedReferenceBytes=0;const checkedReferences=new Map<string,string>();
    const bundles=await approvedBundles(db,batch.bundle_ids);for(const bundle of bundles){validateBundle(bundle);for(const source of bundle.sources){if(source.referenceId){if(checkedReferences.has(source.referenceId)){if(checkedReferences.get(source.referenceId)!==source.sha256)throw Error("Inconsistent shared source hash.");continue;}const retained=await readReferenceBytes(db,source.referenceId);if(retained.source.original_sha256!==source.sha256)throw Error("Pinned rule reference integrity failed.");retainedReferenceBytes+=retained.bytes.length;if(retainedReferenceBytes>64000000)throw Error("Approved reference execution budget exceeded.");checkedReferences.set(source.referenceId,source.sha256);continue;}const bytes=source.encoding==="base64"?Buffer.from(source.body,"base64"):Buffer.from(source.body,"utf8");if(bytes.length>4*1024*1024||createHash("sha256").update(bytes).digest("hex")!==source.sha256)throw Error("A retained historical source failed integrity verification.");}}
    const decisions=await readDecisions(db,ws.customerId,batch.id);const links=await reviewedCatalogueLinks(db,ws.customerId,entries,decisions);
    const fingerprint=sha(stable({referenceIds:[...(batch.reference_ids??[])].sort(),original:original.file.sha256,mapping,options,bundles,decisions,links,engine:AUDIT_VERSION}));
    const lines:{entry:AuditEntry;result:AuditResult}[]=batch.input_hash===fingerprint&&Array.isArray(batch.checkpoint)?batch.checkpoint:[];
    if(lines.some((r,i)=>stable(r.entry)!==stable(entries[i])))throw Error("An interrupted audit input changed; start a new revision.");
    const scopedEntries=referenceEntries(entries,decisions),relatedEntries=entries.map((e,i)=>({...e,...scopedEntries[i]}));
    const execution=referenceExecutionCache(scopedEntries);execution.requireRegistry=true;execution.signal=signal;const started=Date.now();
    let savedCount=lines.length,savedAt=started;
    // Save at most 25 new lines per checkpoint, or every 30 seconds. Mixed-year
    // source groups can contain one line; they need not each rewrite the ledger.
    const checkpoint=async()=>{if(lines.length===savedCount)return;stage='checkpoint';await saveAuditCheckpoint(service,{id:batch.id,customerId:ws.customerId,revision:batch.revision,leaseToken:batch.lease_token},{checkpoint:lines,progress:lines.length,input_hash:fingerprint},signal,()=>send({type:'progress',message:'Retrying the saved progress write…',processed:lines.length,total:entries.length}));savedCount=lines.length;savedAt=Date.now();};
    for(let i=lines.length;i<entries.length;){
      signal.throwIfAborted();if(i>0&&Date.now()-started>120000){await checkpoint();const saved=await service.from('audit_batches').update({status:'interrupted',lease_until:null,last_error:null}).eq('id',batch.id).eq('customer_id',ws.customerId).eq('lease_token',batch.lease_token).select('id').maybeSingle();if(saved.error||!saved.data)throw Error('Audit continuation could not be saved.');send({type:'continue',processed:i,total:entries.length});return;}
      const end=Math.min(referenceGroupEnd(scopedEntries,i),savedCount+25);
      send({type:'progress',message:`Reading dated sources for entry lines ${i+1}–${end}…`,processed:i,total:entries.length});
      stage='dated_sources';const group=entries.slice(i,end),references=await loadAuditReferences(db,scopedEntries.slice(i,end),batch.reference_ids??[],execution);
      stage='calculation';for(let n=0;n<group.length;n++){signal.throwIfAborted();const entry=group[n],at=i+n;lines.push({entry,result:evaluateAuditEntry(entry,bundles,links[at]?.id??null,decisions,false,links[at]?.origin,references[n],options.standardCoverage,options.programExceptionsClear,relatedEntries)});}
      i=end;if(i-savedCount>=25||Date.now()-savedAt>=30000||i===entries.length)await checkpoint();send({type:'progress',message:`Analyzed ${i} of ${entries.length} entry lines.`,processed:i,total:entries.length});
    }
    signal.throwIfAborted();const textLines=lines.map(line=>stable(line));const summary=summarizeAudit(lines.map(l=>l.result));
    stage='commit';const finished=await service.rpc("finish_historical_audit",{target_audit:batch.id,target_customer:ws.customerId,token:batch.lease_token,expected_revision:batch.revision,result_lines:textLines,summary_data:summary,input_fingerprint:fingerprint,engine:AUDIT_VERSION});if(finished.error)throw Error("The audit result could not be committed.");
    const proof=await db.from("tariff_impact_attestations").select("result_sha256,input_sha256").eq("audit_id",batch.id).eq("customer_id",ws.customerId).eq("run_id",finished.data).single();if(proof.error||proof.data.input_sha256!==fingerprint||proof.data.result_sha256!==sha(textLines.join("\n")))throw Error("Audit execution proof could not be verified.");
    send({type:"done",auditId:batch.id,runId:finished.data,verified:true,summary});
  }catch(error){console.error('Historical audit interrupted',{stage,name:error instanceof Error?error.name:'UnknownError',reason:error instanceof Error?error.message.slice(0,1500):'Unknown worker failure'});await service.from("audit_batches").update({status:"interrupted",lease_until:null,last_error:"Audit interrupted or verification failed. Resume the saved audit; no completed calculation is claimed."}).eq("id",batch.id).eq("customer_id",ws.customerId).eq("lease_token",batch.lease_token);send({type:"error",error:"The audit did not finish or could not be verified. Its original and progress remain saved. Resume from this page."});}finally{if(!cancelled)controller.close();}},cancel(){cancelled=true;}}),{headers:{"content-type":"application/x-ndjson","cache-control":"no-store"}});
}
