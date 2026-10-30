import {getAuthenticatedWorkspace,createRequestClient} from '@/lib/supabase/server';
import {withRequestLimit} from '@/app/api/request-limits';
import {isArchiveId} from '@/lib/tariff/business-impact-store';
import {auditOriginal,approvedBundleIds,readDecisions,referenceEntries} from '../../store';
import {parseAudit} from '../../input';
import {AUDIT_VERSION} from '../../model';
import {selectReferenceIds} from '@/app/api/tariff/references/store';

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 return withRequestLimit(request,'upload',1024,async()=>{
  const ws=await getAuthenticatedWorkspace();if(!ws)return Response.json({error:'Authentication required.'},{status:401});
  if(ws.role==='viewer')return Response.json({error:'Write access required.'},{status:403});
  const {id}=await params;if(!isArchiveId(id))return Response.json({error:'Audit not found.'},{status:404});
  try{
   const db=await createRequestClient(),batch=await db.from('audit_batches').select('upload_id,mapping,options').eq('id',id).eq('customer_id',ws.customerId).maybeSingle();
   if(batch.error)throw Error('Audit storage is unavailable.');if(!batch.data)return Response.json({error:'Audit not found.'},{status:404});
   const original=await auditOriginal(ws.customerId,batch.data.upload_id),entries=parseAudit(original.csv,batch.data.mapping,batch.data.options),decisions=await readDecisions(db,ws.customerId,id),scopes=referenceEntries(entries,decisions);
   const ids=await approvedBundleIds(db,scopes),referenceIds=await selectReferenceIds(db,scopes);
   const {data,error}=await db.rpc('refresh_historical_audit_support',{target_audit:id,selected_ids:ids,selected_reference_ids:referenceIds,target_engine_version:AUDIT_VERSION});
   if(error)throw Error('Historical calculation support could not be refreshed. Check that the engine-refresh migration is installed.');
   return Response.json({changed:data===true,message:data?'Historical calculation support updated. Run the new revision; earlier results remain saved.':'This audit already has the current calculation support and saved source versions.'});
  }catch(e){return Response.json({error:e instanceof Error?e.message:'Historical support is unavailable.'},{status:503});}
 });
}
