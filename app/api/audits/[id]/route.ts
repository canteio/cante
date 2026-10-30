import { createRequestClient,getAuthenticatedWorkspace } from "@/lib/supabase/server";
import { isArchiveId } from "@/lib/tariff/business-impact-store";
import { readAudit } from "../store";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){const ws=await getAuthenticatedWorkspace();if(!ws)return Response.json({error:"Authentication required."},{status:401});const {id}=await params;const run=new URL(request.url).searchParams.get("run")??undefined;if(!isArchiveId(id)||run&&!isArchiveId(run))return Response.json({error:"Audit not found."},{status:404});try{const audit=await readAudit(await createRequestClient(),ws.customerId,id,run);return audit?Response.json({...audit,canWrite:ws.role!=="viewer"},{headers:{"cache-control":"no-store"}}):Response.json({error:"Audit not found."},{status:404});}catch(e){return Response.json({error:e instanceof Error?e.message:"Audit unavailable."},{status:503});}}
