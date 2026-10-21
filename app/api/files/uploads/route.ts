import { randomUUID } from "node:crypto";
import { withRequestLimit } from "@/app/api/request-limits";
import { createRequestClient,getAuthenticatedWorkspace } from "@/lib/supabase/server";
import { sanitizeImpactFilename } from "@/lib/tariff/business-impact-store";
import { FILE_MAX_BYTES,FILE_CHUNK_BYTES } from "../upload-store";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(request:Request){return withRequestLimit(request,"upload",2048,async request=>{
 const workspace=await getAuthenticatedWorkspace();if(!workspace)return Response.json({error:"Authentication required."},{status:401});
 if(workspace.role==="viewer")return Response.json({error:"Write access required."},{status:403});
 const body=await request.json().catch(()=>null);
 if(!body||typeof body.filename!=="string"||!Number.isInteger(body.size)||body.size<1||body.size>FILE_MAX_BYTES||!/^([0-9a-f]{64})$/.test(body.sha256??""))return Response.json({error:"Supply a nonempty file up to 15 MiB and its SHA-256 checksum."},{status:400});
 if(body.filename.length>160)return Response.json({error:"Use a filename up to 160 characters so its extension can be preserved."},{status:400});
 if(!/\.(csv|pdf|docx|xlsx|xlsm|txt|md)$/i.test(body.filename))return Response.json({error:"Use CSV, text PDF, Word (.docx), Excel (.xlsx), or plain text."},{status:400});
 const id=randomUUID();const db=await createRequestClient();
 const {error}=await db.from("chat_file_uploads").insert({id,customer_id:workspace.customerId,filename:sanitizeImpactFilename(body.filename),size_bytes:body.size,sha256:body.sha256});
 if(error)return Response.json({error:"Could not reserve this original file. The workspace storage budget may be full."},{status:503});
 return Response.json({id,chunkBytes:FILE_CHUNK_BYTES},{status:201});
});}
