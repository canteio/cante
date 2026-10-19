import { createRequestClient, getAuthenticatedWorkspace } from "@/lib/supabase/server";
import { readLiveCheckArchive } from "@/lib/tariff/business-impact-store";
import { isArchiveId as isUuid } from "@/lib/tariff/business-impact-store";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=300;
const headers={"cache-control":"private, no-store"};
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){
 const workspace=await getAuthenticatedWorkspace();if(!workspace)return Response.json({error:"Authentication required."},{status:401,headers});
 const {id}=await context.params;if(!isUuid(id))return Response.json({error:"Invalid check ID."},{status:400,headers});
 try{
  const full=new URL(request.url).searchParams.get("export")==="true";
  const archive=await readLiveCheckArchive(await createRequestClient(),workspace.customerId,id,full);
  if(!archive)return Response.json({error:"Check not found."},{status:404,headers});
  return Response.json(archive,{headers:full?{...headers,"content-disposition":`attachment; filename="cante-check-${id}.json"`}:headers});
 }catch{return Response.json({error:"Could not read or verify the saved check."},{status:502,headers});}
}
export async function POST(request:Request,context:Context){
 const workspace=await getAuthenticatedWorkspace();if(!workspace)return Response.json({error:"Authentication required."},{status:401,headers});
 if(workspace.role==="viewer")return Response.json({error:"Write access required."},{status:403,headers});
 const {id}=await context.params;if(!isUuid(id))return Response.json({error:"Invalid check ID."},{status:400,headers});
 const reader=request.body?.getReader();if(!reader)return Response.json({error:"Review required."},{status:400,headers});
 let text="";let size=0;const decoder=new TextDecoder();
 while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>20000){await reader.cancel();return Response.json({error:"Review is too long."},{status:413,headers});}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();
 let review:{decision:string;note:string};
 try{review=JSON.parse(text);if(!["reviewed","needs_information","broker_review","superseded"].includes(review.decision)||typeof review.note!=="string"||!review.note.trim()||review.note.trim().length>4000)throw Error();}catch{return Response.json({error:"Select a decision and add a note (1–4,000 characters)."},{status:400,headers});}
 const db=await createRequestClient();const {data:check,error}=await db.from("tariff_check_records").select("id").eq("customer_id",workspace.customerId).eq("id",id).maybeSingle();
 if(error)return Response.json({error:"Could not read check."},{status:502,headers});if(!check)return Response.json({error:"Check not found."},{status:404,headers});
 const {error:writeError}=await db.from("tariff_check_events").insert({customer_id:workspace.customerId,check_id:id,kind:"review",payload_text:JSON.stringify({decision:review.decision,note:review.note.trim()})});
 if(writeError)return Response.json({error:"Could not save review."},{status:502,headers});
 return Response.json({saved:true},{status:201,headers});
}
