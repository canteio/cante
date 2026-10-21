import { withRequestLimit } from "@/app/api/request-limits";
import { createRequestClient,getAuthenticatedWorkspace } from "@/lib/supabase/server";
import { isArchiveId } from "@/lib/tariff/business-impact-store";
import { FILE_CHUNK_BYTES,readOriginalUpload } from "../../upload-store";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=60;
type Context={params:Promise<{id:string}>};
export async function PUT(request:Request,context:Context){return withRequestLimit(request,"upload_chunk",FILE_CHUNK_BYTES,async request=>{
 const workspace=await getAuthenticatedWorkspace();if(!workspace)return Response.json({error:"Authentication required."},{status:401});
 if(workspace.role==="viewer")return Response.json({error:"Write access required."},{status:403});
 const {id}=await context.params;const raw=new URL(request.url).searchParams.get("part");
 if(!isArchiveId(id)||!/^\d{1,2}$/.test(raw??"")||Number(raw)>14)return Response.json({error:"Invalid file chunk."},{status:400});
 const db=await createRequestClient();const {data:upload,error:readError}=await db.from("chat_file_uploads").select("id,actor_id,size_bytes").eq("id",id).eq("customer_id",workspace.customerId).maybeSingle();
 if(readError||!upload||upload.actor_id!==workspace.userId)return Response.json({error:"Upload not found."},{status:404});
 const part=Number(raw);const bytes=Buffer.from(await request.arrayBuffer());
 if(bytes.length!==Math.min(FILE_CHUNK_BYTES,upload.size_bytes-part*FILE_CHUNK_BYTES)||!bytes.length)return Response.json({error:"Invalid chunk length."},{status:400});
 const {error}=await db.from("chat_file_chunks").insert({upload_id:id,customer_id:workspace.customerId,part,body:bytes.toString("base64")});
 if(error)return Response.json({error:"Chunk could not be saved; originals cannot be overwritten. Attach the file again."},{status:409});
 return Response.json({saved:true});
});}
export async function GET(request:Request,context:Context){return withRequestLimit(request,"calculate",0,async()=>{
 const workspace=await getAuthenticatedWorkspace();if(!workspace)return Response.json({error:"Authentication required."},{status:401});
 try{const {id}=await context.params;const {file,bytes}=await readOriginalUpload(workspace.customerId,id);let offset=0;const stream=new ReadableStream<Uint8Array>({pull(controller){if(offset>=bytes.length){controller.close();return;}const end=Math.min(bytes.length,offset+FILE_CHUNK_BYTES);controller.enqueue(new Uint8Array(bytes.buffer,bytes.byteOffset+offset,end-offset));offset=end;}});return new Response(stream,{headers:{"content-type":"application/octet-stream","content-disposition":`attachment; filename="${file.filename.replaceAll('"','_')}"`,"cache-control":"private, no-store","x-content-type-options":"nosniff"}});}
 catch{return Response.json({error:"Could not read or verify this workspace original."},{status:404});}
});}
