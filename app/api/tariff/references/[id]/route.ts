import { createRequestClient,getAuthenticatedWorkspace } from "@/lib/supabase/server";
import { withRequestLimit } from "@/app/api/request-limits";
import { isArchiveId } from "@/lib/tariff/business-impact-store";
import { readReferenceBytes } from "../store";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return withRequestLimit(request,"calculate",3000,async()=>{
 if(!await getAuthenticatedWorkspace())return Response.json({error:"Authentication required."},{status:401});const {id}=await params;if(!isArchiveId(id))return Response.json({error:"Reference not found."},{status:404});
 try{const {source,bytes}=await readReferenceBytes(await createRequestClient(),id);const pdf=bytes.subarray(0,5).equals(Buffer.from("%PDF-")),text=source.metadata.format==='official_text',zip=source.metadata.format==='zip',xml=source.metadata.format==='federal_register_xml';return new Response(new Uint8Array(bytes),{headers:{"content-type":pdf?"application/pdf":zip?'application/zip':xml?'application/xml; charset=utf-8':text?'text/plain; charset=utf-8':"application/json; charset=utf-8","content-disposition":`attachment; filename="tariff-reference.${pdf?"pdf":zip?'zip':xml?'xml':text?'txt':"json"}"`,"x-content-type-options":"nosniff","cache-control":"no-store","x-cante-source-sha256":source.original_sha256}});}catch{return Response.json({error:"Reference unavailable or integrity verification failed."},{status:409});}
});}
