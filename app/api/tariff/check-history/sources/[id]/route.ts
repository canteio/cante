import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { createRequestClient, getAuthenticatedWorkspace } from "@/lib/supabase/server";
import { isArchiveId as isUuid } from "@/lib/tariff/business-impact-store";
export const dynamic="force-dynamic";
export const maxDuration=300;
const headers={"cache-control":"private, no-store"};
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const workspace=await getAuthenticatedWorkspace();if(!workspace)return Response.json({error:"Authentication required."},{status:401,headers});
 const {id}=await params;if(!isUuid(id))return Response.json({error:"Invalid version ID."},{status:400,headers});
 const db=await createRequestClient();const {data,error}=await db.from("tariff_source_versions").select("id,url,sha256,encoding,body,captured_at,compression,original_sha256").eq("customer_id",workspace.customerId).eq("id",id).maybeSingle();
 if(error)return Response.json({error:"Could not read source."},{status:502,headers});if(!data)return Response.json({error:"Source not found."},{status:404,headers});
 const hash=createHash("sha256").update(Buffer.from(data.body,data.encoding==="base64"?"base64":"utf8")).digest("hex");
 if(hash!==data.sha256)return Response.json({error:"Source integrity check failed."},{status:502,headers});
 if(data.compression==="gzip"){
  try{const original=gunzipSync(Buffer.from(data.body,"base64"),{maxOutputLength:32*1024*1024});if(createHash("sha256").update(original).digest("hex")!==data.original_sha256)throw Error();}catch{return Response.json({error:"Original source integrity check failed."},{status:502,headers});}
 }
 return Response.json(data,{headers:{...headers,"content-disposition":`attachment; filename="cante-source-${id}.json"`}});
}
