/** Read-only inventory of every retained edition intersecting the initial
 * copper regime. Structural scope proof only; not numerical/legal validation. */
import{loadEnvConfig}from'@next/env';import{createServiceClient}from'../lib/supabase/service';import{referenceReleases,readReferenceBytes}from'../app/api/tariff/references/store';import{historicalOriginalText}from'../app/api/tariff/references/historical-contract';import{earlierCopperList,earlierMetalLists}from'../app/api/tariff/references/metal-history';import{writeFile}from'node:fs/promises';
loadEnvConfig(process.cwd());
async function main(){
 const db=createServiceClient(),releases=(await referenceReleases(db)).filter(r=>r.available_from<'2026-04-06'&&(!r.available_until||r.available_until>'2025-08-01')).sort((a,b)=>a.available_from.localeCompare(b.available_from));if(releases.length>100)throw Error('The initial copper edition inventory exceeds its 100-source bound.');
 const{data,error}=await db.from('tariff_reference_sources').select('id,release_name,metadata,captured_at').eq('kind','chapter99_pdf').in('release_name',releases.map(r=>r.name)).order('captured_at',{ascending:false}).limit(501);if(error||!data||data.length>500)throw Error('Copper source inventory is unavailable or exceeds its bound.');
 let passed=0;const gaps=[];
 for(const release of releases){const note=data.find(s=>s.release_name===release.name&&s.metadata.revisionVerified===true);if(!note){gaps.push({release:release.name,reason:'No verified retained original.'});continue;}
  const original=await readReferenceBytes(db,note.id),text=await historicalOriginalText(original.bytes),codes=earlierCopperList(text),otherMetals=earlierMetalLists(text);await writeFile('/tmp/cante-'+release.name+'-notes.txt',text);
  if(codes?.length===80&&otherMetals)passed++;else gaps.push({release:release.name,sourceId:note.id,reason:'The complete initial copper scope contract did not match.'});console.log(JSON.stringify({release:release.name,sourceId:note.id,tableCodes:codes?.length??null,complete:!!codes,steelAluminumScope:!!otherMetals}));
 }
 console.log(JSON.stringify({editions:releases.length,passed,gaps,scope:'Original Note 36 tables only; no claim of complete conditional treatments, exact-code rates or legal approval.',customerWrites:0,approvals:0,modelCalls:0}));if(gaps.length)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1});
