import { timingSafeEqual, createHash } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { loadWorkspaceSnapshot } from "@/app/api/tariff/workspace-data";
import { readLiveCheckArchive } from "@/lib/tariff/business-impact-store";
import { executeVerifiedCheck } from "./execute";
import type { LiveCheckResult, LiveSource } from "@/app/api/tariff/live-check/check";
import contract from "@/config/tariff-remedy-contract.json";
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
/** Public headlines remain review leads. Only comparable numerical results can
 * be called a calculated cost change; missing sources are never "no change". */
export function dailyEvent(result:LiveCheckResult){
 const failures=result.sources.filter(s=>s.status==="failed").map(s=>({name:s.name,error:s.error}));
 const comparison=result.comparison;
 const rows=comparison?.rows.filter(r=>r.difference!==null&&r.difference!==0)??[];
 if(rows.length)return {kind:"change",title:`Duty estimates changed for ${rows.length} product${rows.length===1?"":"s"}`,detail:{rows:rows.slice(0,30),comparisonStatus:comparison?.status,sourceFailures:failures}};
 const historical=result.historicalComparison;
 if(historical.candidateSkus.length&& (historical.legalChanges.length||historical.headingChanges.length||historical.baseChanges.length))return {kind:"review",title:"Published tariff changes may affect your products",detail:{skus:historical.candidateSkus,issues:historical.issues,changes:[...historical.legalChanges,...historical.headingChanges,...historical.baseChanges].slice(0,20),limitation:"Applicability and full cost need review; publication text alone is not a confirmed duty change."}};
 if(failures.length)return {kind:"failure",title:"Daily check has incomplete official sources",detail:{sourceFailures:failures}};
 if(result.unresolvedProducts)return {kind:"review",title:`${result.unresolvedProducts} products need tariff information`,detail:{skus:result.rows.filter(r=>!r.stack||r.stack.totalAmount===null||r.error).map(r=>r.product.sku),limitation:"Missing facts or unsupported rules withhold complete duties."}};
 return null;
}
export async function runDailyMonitor(request:Request,withDatabase:<T>(db:ReturnType<typeof createServiceClient>,work:()=>Promise<T>)=>Promise<T>){
 if(process.env.CANTE_DEPLOYMENT_ROLE!=="trusted-check-worker"||process.env.CANTE_TRUSTED_CHECK_WORKER!=="true")return Response.json({error:"Trusted worker required."},{status:409});
 const secret=process.env.CANTE_MONITOR_CRON_SECRET??"",provided=request.headers.get("authorization")??"";
 const expected=`Bearer ${secret}`;
 if(secret.length<32||provided.length!==expected.length||!timingSafeEqual(Buffer.from(provided),Buffer.from(expected)))return Response.json({error:"Unauthorized scheduler."},{status:401});
 const db=createServiceClient();
 const {data:lease,error}=await db.rpc("claim_tariff_daily_monitor");
 if(error)return Response.json({error:"Daily admission unavailable."},{status:503});
 if(!lease)return Response.json({status:"idle"});
 const customer=lease.customer_id,token=lease.lease_token;
 let checkId:string|null=null,sources:LiveSource[]=[];
 const save=async(result:LiveCheckResult)=>{
   const {sources,...report}=result;
   const response=await db.rpc("complete_tariff_daily_check",{target_check_id:checkId,target_customer_id:customer,token,report_text:JSON.stringify(report),sources});
   if(response.error||typeof response.data!=="string")throw Error("Scheduled evidence could not be saved.");return response.data;
 };
 try{
  const snapshot=await loadWorkspaceSnapshot(db,customer);
  if(!snapshot.count)throw Error("Add products before enabling daily checks.");
  const begun=await db.rpc("begin_tariff_daily_check",{target_customer:customer,token,csv:snapshot.csv,engine_info:{contract,build:process.env.VERCEL_GIT_COMMIT_SHA??"worker-build"}});
  if(begun.error||typeof begun.data!=="string")throw Error("Original product inputs could not be saved.");checkId=begun.data;
  const saved=await readLiveCheckArchive(db,customer,checkId);
  if(!saved)throw Error("Saved inputs unavailable.");
  const result=await withDatabase(db,()=>executeVerifiedCheck(db,db,customer,checkId!,saved,AbortSignal.timeout(265000),()=>{},captured=>{sources=captured;},save));
  const event=dailyEvent(result);
  if(event){const detail=JSON.stringify(event.detail);if(Buffer.byteLength(detail)>19000)throw Error("Daily finding exceeds its report budget.");const {error}=await db.from("tariff_daily_events").upsert({customer_id:customer,check_id:checkId,...event,digest:hash(JSON.stringify(event))},{onConflict:"customer_id,digest",ignoreDuplicates:true});if(error)throw Error("Daily notification could not be saved.");}
  const sourceFailure=result.sources.some(s=>s.status==="failed");
  const finished=await db.rpc("finish_tariff_daily_monitor",{target_customer:customer,token,success:!sourceFailure,error_detail:sourceFailure?"Some official sources failed; retained results are partial. A retry is scheduled.":null});
  if(finished.error)throw Error("Daily status could not be saved.");
  return Response.json({status:sourceFailure?"partial":"completed",checkId});
 }catch{
  if(checkId){await db.rpc("complete_tariff_daily_check",{target_check_id:checkId,target_customer_id:customer,token,report_text:JSON.stringify({error:"Scheduled check did not finish. No verified complete result is claimed."}),sources,outcome:"failed"});
   const event={kind:"failure",title:"Daily check could not finish",detail:{reason:"Review saved inputs and retry the check. No successful no-change result is claimed."}};await db.from("tariff_daily_events").upsert({customer_id:customer,check_id:checkId,...event,digest:hash(JSON.stringify(event))},{onConflict:"customer_id,digest",ignoreDuplicates:true});}
  await db.rpc("finish_tariff_daily_monitor",{target_customer:customer,token,success:false,error_detail:"Daily check could not finish. Check saved products and official-source availability."});
  return Response.json({status:"failed",checkId},{status:503});
 }
}
