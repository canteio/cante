import { createHash } from "node:crypto";
import { createRequestClient } from "@/lib/supabase/server";
import { isArchiveId } from "@/lib/tariff/business-impact-store";
export const FILE_MAX_BYTES=15*1024*1024;
export const FILE_CHUNK_BYTES=1024*1024;
export async function readOriginalUpload(customerId:string,id:string){
 if(!isArchiveId(id))throw Error("Invalid original-file reference.");
 const db=await createRequestClient();
 const {data:file,error}=await db.from("chat_file_uploads").select("id,customer_id,filename,size_bytes,sha256,created_at").eq("id",id).eq("customer_id",customerId).maybeSingle();
 if(error||!file)throw Error("Original file is unavailable in this workspace.");
 if(!Number.isInteger(file.size_bytes)||file.size_bytes<1||file.size_bytes>FILE_MAX_BYTES)throw Error("Original file exceeds the size limit.");
 const parts:Buffer[]=[];
 for(let part=0;part<Math.ceil(file.size_bytes/FILE_CHUNK_BYTES);part++){
  const {data,error}=await db.from("chat_file_chunks").select("body").eq("upload_id",id).eq("customer_id",customerId).eq("part",part).maybeSingle();
  if(error||!data)throw Error("The original upload is incomplete. Attach the file again.");
  const bytes=Buffer.from(data.body,"base64");
  if(bytes.length!==Math.min(FILE_CHUNK_BYTES,file.size_bytes-part*FILE_CHUNK_BYTES))throw Error("Original upload chunk integrity check failed.");
  parts.push(bytes);
 }
 const bytes=Buffer.concat(parts,file.size_bytes);
 if(createHash("sha256").update(bytes).digest("hex")!==file.sha256)throw Error("Original file checksum verification failed.");
 return {file,bytes};
}
