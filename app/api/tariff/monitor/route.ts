import { createRequestClient,getAuthenticatedWorkspace } from "@/lib/supabase/server";
import { withRequestLimit } from "@/app/api/request-limits";
export const dynamic="force-dynamic";
const headers={"cache-control":"private, no-store"};
export async function GET(){
 const workspace=await getAuthenticatedWorkspace();if(!workspace)return Response.json({error:"Authentication required."},{status:401,headers});
 const db=await createRequestClient();
 const [settings,events]=await Promise.all([
  db.from("tariff_daily_monitors").select("enabled,configured_at,next_check_at,last_attempt_at,last_success_at,last_check_id,last_status,last_error").eq("customer_id",workspace.customerId).maybeSingle(),
  db.from("tariff_daily_events").select("id,check_id,created_at,kind,title,detail").eq("customer_id",workspace.customerId).order("created_at",{ascending:false}).order("id").limit(10)
 ]);
 if(settings.error||events.error)return Response.json({error:"Daily checks are unavailable. Manual checks remain available."},{status:503,headers});
 return Response.json({settings:settings.data,events:events.data,canManage:["owner","admin"].includes(workspace.role)},{headers});
}
export async function PATCH(request:Request){return withRequestLimit(request,"calculate",1024,async bounded=>{
 const workspace=await getAuthenticatedWorkspace();if(!workspace)return Response.json({error:"Authentication required."},{status:401});
 if(!["owner","admin"].includes(workspace.role))return Response.json({error:"Workspace owner or admin required."},{status:403});
 let enabled;try{const body=await bounded.json();if(typeof body.enabled!=="boolean"||Object.keys(body).length!==1)throw Error();enabled=body.enabled;}catch{return Response.json({error:"Choose whether daily checks are enabled."},{status:400});}
 const db=await createRequestClient();const {error}=await db.rpc("set_tariff_daily_monitor",{target_customer:workspace.customerId,enable:enabled});
 return error?Response.json({error:"Daily setting could not be saved."},{status:503}):Response.json({enabled},{headers});
});}
