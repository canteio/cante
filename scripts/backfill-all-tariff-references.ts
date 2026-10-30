/** Operator-only, resumable public-source capture. No customer writes, legal
 * approvals, LLM calls or scheduled jobs. Run without --write to inspect sources. */
import {loadEnvConfig} from '@next/env';
import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {archiveIndex,fetchReference,officialSourceChallenge,normalizeReleases,projectHistoricalRates,referencePackage,registryUrl,officialReferenceUrl} from '../app/api/tariff/references/ingestion';
import {digest} from '../app/api/tariff/references/store';
import {HISTORICAL_ACTIONS} from '../app/api/tariff/references/historical-contract';
import {createServiceClient} from '../lib/supabase/service';
import {publishOfficialReference} from './publish-official-reference';
loadEnvConfig(process.cwd());
const args=process.argv.slice(2),write=args.includes('--write');
const selected=args.find(a=>a.startsWith('--releases='))?.slice(11).split(',');
if(args.some(a=>a!=='--write'&&a!=='--actions-only'&&!a.startsWith('--releases=')))throw Error('Use [--write] [--actions-only] [--releases=publisher-name,...]');
const directory=resolve('raw/tariff-references/bulk'),events=resolve(directory,'events.ndjson');
const db=write?createServiceClient():null;
const failures:{item:string;reason:string}[]=[],completed:string[]=[],skipped:string[]=[];
async function report(event:Record<string,unknown>){const line=JSON.stringify({at:new Date().toISOString(),...event});console.log(line);await appendFile(events,line+'\n');}
async function parallel<T>(items:T[],limit:number,fn:(item:T)=>Promise<void>){let next=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const item=items[next++];await fn(item);}}));}
async function cached(url:string,maxBytes=25000000){officialReferenceUrl(url);const file=resolve(directory,digest(url)+'.bin');try{const bytes=await readFile(file);if(bytes.length>maxBytes)throw Error('Cached original exceeds byte limit');if(!officialSourceChallenge(bytes))return bytes;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}let failure:unknown;for(let attempt=0;attempt<2;attempt++){try{const bytes=await fetchReference(url,maxBytes);await writeFile(file,bytes);return bytes;}catch(error){failure=error;}}throw failure;}
async function publish(pack:ReturnType<typeof referencePackage>,rates:ReturnType<typeof projectHistoricalRates>=[]){
 if(db)return publishOfficialReference(db,pack,rates);
}

async function main(){
 await mkdir(directory,{recursive:true});
 // Refresh discovery, rather than letting an old local registry hide new editions.
 const registry=await fetchReference(registryUrl,2000000),releases=normalizeReleases(JSON.parse(registry.toString('utf8')));
 if(db){const saved=await db.from('tariff_reference_releases').upsert(releases,{onConflict:'name'});if(saved.error)throw Error(saved.error.message);}
 await publish(referencePackage({kind:'release_registry',url:registryUrl,title:'Official USITC release availability registry',bytes:registry,metadata:{releases}}));
 const queue=args.includes('--actions-only')?[]:['https://www.usitc.gov/harmonized_tariff_information/hts/archive/list'],seen=new Set<string>(),editions=new Map<string,ReturnType<typeof archiveIndex>['editions'][number]>(),unsupported:ReturnType<typeof archiveIndex>['unavailable']=[];
 while(queue.length){const url=queue.shift()!;if(seen.has(url))continue;if(seen.size>=20)throw Error('Archive pagination exceeded 20-page discovery bound');seen.add(url);try{const bytes=await cached(url,3000000),page=archiveIndex(bytes.toString('utf8'),url);for(const e of page.editions){const prior=editions.get(e.release);if(prior&&prior.json!==e.json)throw Error(`Ambiguous original for ${e.release}`);editions.set(e.release,e);}unsupported.push(...page.unavailable);for(const next of page.pages)if(!seen.has(next)&&!queue.includes(next))queue.push(next);}catch(error){failures.push({item:url,reason:String(error)});} }
 const missing=args.includes('--actions-only')?[]:releases.filter(r=>!editions.has(r.name));
 const manifest={registry:releases.length,discovered:editions.size,missing:missing.map(r=>r.name),unsupported,editions:[...editions.values()]};await writeFile(resolve(directory,'discovery.json'),JSON.stringify(manifest,null,2));
 await report({phase:'discovered',discoverySkipped:args.includes('--actions-only'),registry:releases.length,jsonEditions:editions.size,missing:missing.length,olderOrUnsupported:unsupported.length});
 const existing=new Set<string>(),existingNotes=new Set<string>(),existingPdfs=new Set<string>();if(db){const q=await db.from('tariff_reference_sources').select('release_name,kind,metadata').limit(2000);if(q.error)throw Error(q.error.message);for(const s of q.data??[]){if(s.kind==='chapter99_pdf')existingNotes.add(s.release_name!);if(s.kind==='legal_document'&&s.metadata?.fullSchedule===true)existingPdfs.add(s.release_name!);}const c=await db.from('tariff_reference_catalogue').select('release_name').eq('kind','hts_json').eq('projection_complete',true).limit(1000);if(c.error)throw Error(c.error.message);for(const s of c.data??[])existing.add(s.release_name!);}
 const documents=new Map<string,Promise<void>>();
 async function amendment(number:string){let promise=documents.get(number);if(!promise){promise=(async()=>{const meta=JSON.parse((await cached(`https://www.federalregister.gov/api/v1/documents/${number}.json`,2000000)).toString('utf8'));if(meta.document_number!==number||typeof meta.pdf_url!=='string')throw Error('Amendment identity missing');const bytes=await cached(meta.pdf_url,25000000);if(!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('Amendment original is not PDF');await publish(referencePackage({kind:'legal_document',url:meta.pdf_url,title:String(meta.title).slice(0,300),bytes,external:true,metadata:{documentNumber:number,publicationDate:meta.publication_date,effectiveOn:meta.effective_on??null,datesText:meta.dates??null,htmlUrl:meta.html_url}}));})();documents.set(number,promise);}await promise;}
 for(const number of HISTORICAL_ACTIONS)try{await amendment(number);}catch(error){failures.push({item:`action:${number}`,reason:String(error)});}
 await parallel(releases.filter(r=>!args.includes('--actions-only')&&(!selected||selected.includes(r.name))).sort((a,b)=>b.available_from.localeCompare(a.available_from)),2,async release=>{
  const edition=editions.get(release.name);
  try{
   const details=JSON.parse((await cached(`https://hts.usitc.gov/reststop/releaseDetails?release=${release.name}`,2000000)).toString('utf8'));
   if(details.reldetail?.name!==release.name)throw Error('Historical release identity mismatch');
   if(!existingNotes.has(release.name)){
    if(!Object.hasOwn(details.pdfList??{},'Chapter 99_III'))throw Error('Versioned Chapter 99 original absent');
    const notesUrl=`https://hts.usitc.gov/reststop/file?release=${release.name}&filename=Chapter%2099_III`,notes=await cached(notesUrl);
    if(!notes.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('Chapter 99 original is not PDF');
    const {getDocumentProxy,extractText}=await import('unpdf');const doc=await getDocumentProxy(new Uint8Array(notes));if(doc.numPages>700)throw Error('Chapter 99 exceeds page limit');const text=(await extractText(doc,{mergePages:true})).text.replace(/\s+/g,' '),revision=/Revision\s+(\d+[a-z]?)/i.exec(release.description)?.[1];
    const revisionVerified=text.includes(release.name.slice(0,4))&&(!revision||new RegExp(`Revision\\s+${revision.replace(/[a-z]$/i,'')}`).test(text));
    if(!revisionVerified)failures.push({item:release.name+':chapter99_identity',reason:'Publisher returned a PDF whose printed edition identity was not established; retained as unverified evidence, unavailable to the compiler.'});
    await publish(referencePackage({kind:'chapter99_pdf',url:notesUrl,title:release.description+': Chapter 99 legal notes',bytes:notes,release_name:release.name,metadata:{release,revisionVerified,pageCount:doc.numPages}}));await report({phase:revisionVerified?'chapter99_complete':'chapter99_unverified',release:release.name,bytes:notes.length,write});
   }
   // Versioned full-schedule PDFs remain usable original evidence even when
   // the publisher's separate JSON host returns an access challenge.
   if(!existingPdfs.has(release.name)&&Object.hasOwn(details.pdfList??{},'finalCopy'))try{
    const url=`https://hts.usitc.gov/reststop/file?release=${release.name}&filename=finalCopy`,bytes=await cached(url);
    if(!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('Full schedule original is not PDF');
    await publish(referencePackage({kind:'legal_document',url,title:release.description+': original complete schedule PDF',bytes,release_name:release.name,external:true,metadata:{release,fullSchedule:true,rateProjection:false,identity:'Versioned publisher download; no automatic rate or legal approval'}}));await report({phase:'schedule_pdf_complete',release:release.name,bytes:bytes.length,write});
   }catch(error){failures.push({item:`${release.name}:full_pdf`,reason:String(error)});}
   if(!existing.has(release.name)&&edition)try{
    const bytes=await cached(edition.json),rates=projectHistoricalRates(JSON.parse(bytes.toString('utf8')));
    await publish(referencePackage({kind:'hts_json',url:edition.json,title:release.description+': original JSON schedule',bytes,release_name:release.name,metadata:{editionPage:edition.indexUrl,release,modifyingDocuments:edition.notices,projectionVersion:'hts-leaves-v1',availabilityIsLegalEffectiveDate:false}}),rates);
    completed.push(release.name);await report({phase:'edition_complete',release:release.name,rateRows:rates.length,write});
   }catch(error){failures.push({item:`${release.name}:json`,reason:String(error)});}
   else if(existing.has(release.name))skipped.push(release.name);else failures.push({item:`${release.name}:json`,reason:'No publisher-linked JSON found'});
   for(const url of edition?.notices??[]){const number=/\/(\d{4}-\d+)(?:\/|$)/.exec(url)?.[1];if(number)try{await amendment(number);}catch(error){failures.push({item:`${release.name}:amendment:${number}`,reason:String(error)});}}
  }catch(error){failures.push({item:release.name,reason:String(error)});await report({phase:'failed',release:release.name,reason:String(error)});}
 });
 const summary={write,registry:releases.length,completed,skipped,missing:missing.map(r=>r.name),unsupported,failures,finishedAt:new Date().toISOString()};await writeFile(resolve(directory,'summary.json'),JSON.stringify(summary,null,2));await report({phase:'finished',write,completed:completed.length,skipped:skipped.length,failures:failures.length,missing:missing.length});if(failures.length)process.exitCode=1;
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
