import { withRequestLimit } from "@/app/api/request-limits";
import { getAuthenticatedWorkspace,createRequestClient } from "@/lib/supabase/server";
import { isArchiveId } from "@/lib/tariff/business-impact-store";
import { checkWorkerConfigured,dispatchSignature } from "@/app/api/tariff/live-check/worker-client";
export const runtime="nodejs";export const maxDuration=300;
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return withRequestLimit(request,"check",1024,async request=>{
  const ws=await getAuthenticatedWorkspace();if(!ws)return Response.json({error:"Authentication required."},{status:401});if(ws.role==="viewer")return Response.json({error:"Write access required."},{status:403});const {id}=await params;if(!isArchiveId(id))return Response.json({error:"Audit not found."},{status:404});
  if(!checkWorkerConfigured())return Response.json({error:"The trusted audit worker is not configured. Your original data remains saved."},{status:503});
  const db=await createRequestClient();const {data:batch,error}=await db.from("audit_batches").select("id,revision,status").eq("customer_id",ws.customerId).eq("id",id).maybeSingle();if(error||!batch)return Response.json({error:"Audit not found."},{status:404});if(batch.status==="completed")return Response.json({error:"This revision is already complete. Record new facts to create a revised calculation."},{status:409});
  try{const target=new URL(process.env.CANTE_CHECK_WORKER_URL!);const local=["localhost","127.0.0.1","[::1]"].includes(target.hostname);if((target.protocol!=="https:"&&!(target.protocol==="http:"&&local&&!process.env.VERCEL))||target.username||target.password||target.search||target.hash||target.pathname!=="/api/check")throw Error();
    const session=await db.auth.getSession();if(session.error||!session.data.session?.access_token)throw Error();const authorization=`Bearer ${session.data.session.access_token}`,timestamp=Date.now().toString();const body=JSON.stringify({task:"historical_audit",auditId:id,customerId:ws.customerId,revision:batch.revision});
    const response=await fetch(target,{method:"POST",redirect:"error",cache:"no-store",signal:request.signal,headers:{"content-type":"application/json",authorization,"x-cante-task":"historical-audit","x-cante-dispatched-at":timestamp,"x-cante-dispatch-signature":dispatchSignature(process.env.CANTE_CHECK_DISPATCH_SECRET!,timestamp,body,authorization)},body});
    if(!response.ok||!response.body)return Response.json({error:"The audit worker is unavailable or this audit is already running. Your input remains saved."},{status:response.status===409?409:503});
    return new Response(response.body,{headers:{"content-type":"application/x-ndjson","cache-control":"no-store"}});
  }catch{return Response.json({error:"The trusted audit worker is unavailable. No successful calculation is claimed."},{status:503});}
});}
