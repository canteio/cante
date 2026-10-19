import { createRequestClient, getAuthenticatedWorkspace } from "@/lib/supabase/server";
import { isArchiveId as isUuid } from "@/lib/tariff/business-impact-store";
export const dynamic="force-dynamic";
const headers={"cache-control":"private, no-store"};
/** Cursor pages avoid silently truncating the archive to a single database page. */
export async function GET(request:Request){
 const workspace=await getAuthenticatedWorkspace();if(!workspace)return Response.json({error:"Authentication required."},{status:401,headers});
 const url=new URL(request.url);const sources=url.searchParams.get("view")==="sources";
 const cursor=url.searchParams.get("before");let boundary:{date:string;id:string}|null=null;
 if(cursor){try{boundary=JSON.parse(cursor);if(!boundary||!/^\d{4}-\d{2}-\d{2}T[\d:.+-]+Z?$/.test(boundary.date)||!isUuid(boundary.id))throw Error();}catch{return Response.json({error:"Invalid history cursor."},{status:400,headers});}}
 const db=await createRequestClient();const date=sources?"captured_at":"created_at";
 let query=db.from(sources?"tariff_source_versions":"tariff_check_records").select(sources?"id,url,sha256,encoding,captured_at":"id,filename,created_at,actor_id,engine,tariff_check_events(id,kind,created_at)").eq("customer_id",workspace.customerId).order(date,{ascending:false}).order("id",{ascending:false}).limit(26);
 if(!sources)query=query.in("tariff_check_events.kind",["completed","failed"]);
 if(boundary)query=query.or(`${date}.lt.${boundary.date},and(${date}.eq.${boundary.date},id.lt.${boundary.id})`);
 const {data,error}=await query;if(error)return Response.json({error:"Could not load history."},{status:502,headers});
 const rows=data??[];const page=rows.slice(0,25);const last=page.at(-1) as unknown as Record<string,string>|undefined;
 return Response.json({items:page,next:rows.length>25&&last?JSON.stringify({date:last[date],id:last.id}):null,canReview:workspace.role!=="viewer",coverage:"Versions captured by this workspace's live checks. Capture dates are not legal effective dates; this is not a complete history of laws."},{headers});
}
