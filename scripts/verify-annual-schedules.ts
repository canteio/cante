/** Read-only public-source provenance/storage checks. Not a shipment audit,
 * approval, complete table projection or proof of legal coverage. */
import assert from 'node:assert/strict';
import {loadEnvConfig} from '@next/env';
import {createServiceClient} from '../lib/supabase/service';
import {readReferenceBytes} from '../app/api/tariff/references/store';
import {proveAnnualScheduleIdentity} from '../app/api/tariff/references/ordinary-contract';
import {historicalAnnualChapterRates} from '../app/api/tariff/references/pdf-rates';
loadEnvConfig(process.cwd());
async function main(){
 const db=createServiceClient(),q=await db.from('tariff_reference_catalogue').select('id,kind,url,metadata').eq('metadata->>role','annual_schedule_chapter').order('id').limit(1000);
 if(q.error)throw Error(q.error.message);assert.equal(q.data?.filter(s=>[2016,2017].includes(Number(s.metadata.annualScheduleYear))).length,384,'Four complete 96-chapter original sets are required.');
 const children=q.data!.filter(s=>[2016,2017].includes(Number(s.metadata.annualScheduleYear))),parentIds=[...new Set(children.flatMap(s=>['registryId','detailsId','archiveId'].map(k=>s.metadata[k] as string)))];assert(parentIds.length<=100);
 const p=await db.from('tariff_reference_sources').select('id,kind,url,metadata').in('id',parentIds).limit(101);if(p.error)throw Error(p.error.message);assert.equal(p.data?.length,parentIds.length);
 const originals=new Map<string,Buffer>();for(const s of p.data!){const raw=await readReferenceBytes(db,s.id);assert(raw.bytes.length<=3000000);originals.set(s.id,raw.bytes);}
 const counts:Record<string,Set<string>>={};let externalChapters=0;
 for(const s of children){
  const parents=['registryId','detailsId','archiveId'].map(k=>p.data!.find(v=>v.id===s.metadata[k])!);assert(parents.every(Boolean));
  const identity=proveAnnualScheduleIdentity({source:s,registrySource:parents[0],detailsSource:parents[1],archiveSource:parents[2],registry:JSON.parse(originals.get(parents[0].id)!.toString('utf8')),details:JSON.parse(originals.get(parents[1].id)!.toString('utf8')),archive:originals.get(parents[2].id)!.toString('utf8')});assert(identity,'Pinned original identity must hold for '+s.url);
  const key=identity.year+':'+identity.publisherRelease;counts[key]??=new Set();assert(!counts[key].has(identity.chapter));counts[key].add(identity.chapter);if(s.metadata.storage)externalChapters++;
  if(identity.chapter==='84'){
   // These four files have section-preface pages and use object storage. Verify
   // both byte hashes and the whole chapter identity, not only metadata.
   assert.equal(s.metadata.storage?.bucket,'official-tariff-references');const raw=await readReferenceBytes(db,s.id),rates=await historicalAnnualChapterRates(raw.bytes,s.id,identity,['8421210000']);assert.equal(rates.length,1);assert.equal(rates[0].general,'Free');assert.equal(rates[0].hts,'8421210000');console.log(JSON.stringify({year:identity.year,edition:identity.publisherRelease,sourceId:s.id,objectStorage:true,originalBytes:raw.bytes.length,publishedCode:rates[0].hts,publishedGeneral:rates[0].general,page:rates[0].pdfPage,fullChapterIdentityVerified:true}));
  }
 }
 assert.equal(Object.keys(counts).length,4);for(const chapters of Object.values(counts))assert.equal(chapters.size,96);
 console.log(JSON.stringify({chapterIdentities:children.length,editions:Object.fromEntries(Object.entries(counts).map(([k,v])=>[k,v.size])),parentOriginals:parentIds.length,externalChapters,fullChapterSamples:4,writes:0,models:0,approvals:0,limitation:'Original identity and four full chapter/table/storage samples only; no complete shipment treatment or all-formula coverage is inferred.'}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
