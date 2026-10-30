import { createRequestClient,getAuthenticatedWorkspace } from "@/lib/supabase/server";
import { withRequestLimit } from "@/app/api/request-limits";
import { isStrictIsoDate } from "@/lib/tariff/date";
import { selectReferenceIds,loadAuditReferences } from "./store";
export const dynamic="force-dynamic";
export async function GET(request:Request){return withRequestLimit(request,"calculate",3000,async()=>{
 const ws=await getAuthenticatedWorkspace();if(!ws)return Response.json({error:"Authentication required."},{status:401});
 const query=new URL(request.url).searchParams,hts=query.get("hts")??"",date=query.get("date")??"";
 if(!/^\d{10}$/.test(hts)||!isStrictIsoDate(date))return Response.json({error:"Supply an exact statistical code and historical entry date."},{status:400});
 try{const db=await createRequestClient(),entries=[{hts,date}],ids=await selectReferenceIds(db,entries);const [reference]=await loadAuditReferences(db,entries,ids);return Response.json({reference,coverage:"Captured references are not automatically approved legal rules."},{headers:{"cache-control":"no-store"}});}catch{return Response.json({error:"Historical reference lookup unavailable; no rate was guessed."},{status:503});}
});}
