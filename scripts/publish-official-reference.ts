import type {createServiceClient} from '../lib/supabase/service';
import {referencePackage} from '../app/api/tariff/references/ingestion';
import {digest,type ReferenceRate} from '../app/api/tariff/references/store';
/** Operator-only publisher. Keeps the existing immutable source/chapter contract. */
export async function publishOfficialReference(db:ReturnType<typeof createServiceClient>,pack:ReturnType<typeof referencePackage>,rates:Omit<ReferenceRate,'source_id'>[]=[]){
 const {storageBytes,...source}=pack;
 if(storageBytes){const storage=source.metadata.storage!;const uploaded=await db.storage.from(storage.bucket).upload(storage.path,storageBytes,{contentType:'application/octet-stream',upsert:false});if(uploaded.error&&!['409','400'].includes(String(uploaded.error.statusCode)))throw Error(uploaded.error.message);if(uploaded.error){const retained=await db.storage.from(storage.bucket).download(storage.path);if(retained.error||retained.data.size!==storageBytes.length||digest(Buffer.from(await retained.data.arrayBuffer()))!==storage.storedSha256)throw Error('Existing original object differs');}}
 const {data:id,error}=await db.rpc('publish_tariff_reference',{source:{...source,...(rates.length?{metadata:{...source.metadata,expectedRateCount:rates.length}}:{})},rates:[]});if(error)throw Error(error.message);
 if(rates.length){
  const retained=await db.from('tariff_reference_publications').select('chapter').eq('source_id',id).limit(100);if(retained.error)throw Error(retained.error.message);const chapters=new Set((retained.data??[]).map(r=>r.chapter));
  const missing=Array.from({length:99},(_,i)=>String(i+1).padStart(2,'0')).filter(c=>!chapters.has(c));let next=0;
  await Promise.all(Array.from({length:Math.min(4,missing.length)},async()=>{while(next<missing.length){const chapter=missing[next++],rows=rates.filter(r=>r.hts.startsWith(chapter)).sort((a,b)=>a.hts.localeCompare(b.hts));const result=await db.rpc('publish_tariff_reference_chapter',{target_source:id,target_chapter:chapter,chapter_rows:rows});if(result.error)throw Error(`Chapter ${chapter}: ${result.error.message}`);}}));
  const complete=await db.from('tariff_reference_catalogue').select('projection_complete').eq('id',id).single();if(complete.error||!complete.data?.projection_complete)throw Error('Edition remains incomplete');
 }
 return id as string;
}
