/** Operator-only originals for same-year annual-rate corroboration. No customer
 * records, legal approval, models or schedules. Atomic immutable source capture;
 * chapter files are not published as a complete projected tariff schedule. */
import{loadEnvConfig}from'@next/env';
import{mkdir,readFile,writeFile,appendFile}from'node:fs/promises';
import{resolve}from'node:path';
import{getDocumentProxy}from'unpdf';
import{load}from'cheerio';
import{fetchReference,registryUrl,referencePackage,normalizeReleases}from'../app/api/tariff/references/ingestion';
import{digest}from'../app/api/tariff/references/store';
import{createServiceClient}from'../lib/supabase/service';
import{publishOfficialReference}from'./publish-official-reference';
import{isStrictIsoDate}from'../lib/tariff/date';
loadEnvConfig(process.cwd());
const args=process.argv.slice(2),write=args.includes('--write'),years=(args.find(a=>a.startsWith('--years='))?.slice(8)??'2016,2017').split(',').map(Number),chapters=(args.find(a=>a.startsWith('--chapters='))?.slice(11).split(',')??Array.from({length:97},(_,i)=>String(i+1).padStart(2,'0')).filter(c=>c!=='77'));
if(args.some(a=>a!=='--write'&&!a.startsWith('--years=')&&!a.startsWith('--chapters='))||!years.length||years.some(y=>![2015,2016,2017].includes(y))||new Set(years).size!==years.length||!chapters.length||chapters.some(c=>!/^\d{2}$/.test(c)||Number(c)<1||Number(c)>97||c==='77')||new Set(chapters).size!==chapters.length)throw Error('Use [--write] [--years=2016,2017] [--chapters=01,...,97].');
const dir=resolve('raw/tariff-references/annual-schedules'),db=write?createServiceClient():null,retainedIds=new Map<string,string>();
async function cached(url:string,max=25000000){const path=resolve(dir,digest(url)+'.bin');try{const b=await readFile(path);if(b.length>max)throw Error('Cached original exceeds bounds.');return b;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}const bytes=await fetchReference(url,max);await writeFile(path,bytes);return bytes;}
async function save(kind:string,url:string,title:string,bytes:Buffer,metadata:Record<string,unknown>){const key=url+':'+digest(bytes),retained=retainedIds.get(key);if(retained)return retained;const pack=referencePackage({kind,url,title,bytes,metadata,external:metadata.role==='annual_schedule_chapter'?'always':true});const id=db?await publishOfficialReference(db,pack):null;if(id)retainedIds.set(key,id);return id;}
async function event(value:Record<string,unknown>){const line=JSON.stringify({at:new Date().toISOString(),...value});console.log(line);await appendFile(resolve(dir,'events.ndjson'),line+'\n');}
async function main(){
 await mkdir(dir,{recursive:true});if(db){for(let offset=0;offset<2000;offset+=500){const q=await db.from('tariff_reference_sources').select('id,url,original_sha256').or('kind.eq.release_registry,metadata->>role.in.(annual_schedule_archive,annual_schedule_details,annual_schedule_chapter)').order('id').range(offset,offset+499);if(q.error)throw Error(q.error.message);for(const r of q.data??[])retainedIds.set(r.url+':'+r.original_sha256,r.id);if((q.data?.length??0)<500)break;if(offset===1500)throw Error('Older source resume index exceeds its 2,000-record bound.');}}const archiveUrl='https://www.usitc.gov/harmonized_tariff_information/hts/archive/list?page=7',archive=await cached(archiveUrl,3000000),$=load(archive.toString('utf8')),linked=new Map<string,{year:number;title:string}>();
 $('.views-field-nothing').each((_,node)=>{const row=$(node).parent(),title=row.children().first().text().replace(/\s+/g,' ').trim(),match=/^(201[567]) HTSA (?!Preliminary)/.exec(title);if(!match||!years.includes(Number(match[1])))return;row.find('a[href]').each((_,a)=>{const url=new URL($(a).attr('href')!,archiveUrl);if(url.protocol==='http:'&&url.hostname==='hts.usitc.gov')url.protocol='https:';const name=url.searchParams.get('release');if(url.origin==='https://hts.usitc.gov'&&name&&/^[A-Za-z0-9][A-Za-z0-9_]{0,79}$/.test(name))linked.set(name,{year:Number(match[1]),title});});});
 const registryBytes=await fetchReference(registryUrl,2000000),registry=JSON.parse(registryBytes.toString('utf8'));if(!Array.isArray(registry)||registry.length>3000)throw Error('Invalid original release registry.');
 const registryId=await save('release_registry',registryUrl,'Official USITC release registry original',registryBytes,{role:'annual_schedule_registry',releases:normalizeReleases(registry)}),archiveId=await save('legal_document',archiveUrl,'USITC archive: older published edition links',archive,{role:'annual_schedule_archive'});
 const failures:{name:string;chapter?:string;reason:string}[]=[],completed:unknown[]=[];
 for(const[name,edition]of linked){
  const matches=registry.filter(r=>r.name===name&&r.status==='archive'&&String(r.description).startsWith(String(edition.year)+' '));if(matches.length!==1){failures.push({name,reason:'One matching dated publisher registry record is required.'});continue;}
  for(const field of ['date','releaseStartDate','releaseEndDate']){const value=matches[0][field],m=typeof value==='string'?/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value):null;if(!m||!isStrictIsoDate(`${m[3]}-${m[1]}-${m[2]}`))throw Error('Older edition has no bounded valid '+field);}
  const detailsUrl='https://hts.usitc.gov/reststop/releaseDetails?release='+encodeURIComponent(name),detailsBytes=await cached(detailsUrl,2000000),details=JSON.parse(detailsBytes.toString('utf8'));
  if(details.reldetail?.name!==name||details.reldetail?.description!==matches[0].description||details.reldetail?.releaseStartDate!==matches[0].releaseStartDate||details.reldetail?.releaseEndDate!==matches[0].releaseEndDate){failures.push({name,reason:'Edition details and retained registry do not match.'});continue;}
  const detailsId=await save('legal_document',detailsUrl,edition.title+': original edition details',detailsBytes,{role:'annual_schedule_details',annualScheduleYear:edition.year,publisherRelease:name,registryId,archiveId});
  let next=0;await Promise.all(Array.from({length:2},async()=>{while(next<chapters.length){const chapter=chapters[next++];try{
   const filename='Chapter '+Number(chapter);if(!Object.hasOwn(details.pdfList??{},filename))throw Error('The edition does not list this chapter PDF.');
   const url='https://hts.usitc.gov/reststop/file?release='+encodeURIComponent(name)+'&filename='+encodeURIComponent(filename),bytes=await cached(url);if(bytes.subarray(0,5).toString()!=='%PDF-')throw Error('Original chapter is not a PDF.');
   const doc=await getDocumentProxy(new Uint8Array(bytes));let pages=0;try{pages=doc.numPages;if(pages<1||pages>250)throw Error('Chapter exceeds its 250-page bound.');let found=false;for(let p=1;p<=Math.min(12,pages);p++){const page=await(await doc.getPage(p)).getTextContent();if(page.items.length>12000)throw Error('Chapter identity page exceeds item bound.');const text=page.items.flatMap(i=>'str'in i?[i.str]:[]).join(' ').replace(/\s+/g,' ');if(!text.includes('Harmonized Tariff Schedule of the United States ('+edition.year+')'))throw Error('Printed year identity is not established.');if(new RegExp('(?:^|\\s)'+Number(chapter)+'\\s*-\\s*1(?:\\s|$)').test(text)){found=true;break;}}if(!found)throw Error('Printed chapter identity is not established within the bounded section preface.');}finally{await doc.loadingTask.destroy();}
   const id=await save('legal_document',url,edition.title+': original Chapter '+Number(chapter)+' PDF',bytes,{role:'annual_schedule_chapter',annualScheduleYear:edition.year,chapter,publisherRelease:name,registryId,detailsId,archiveId,pages,printedYearChapterVerified:true,projection:false,scope:'Same-year formula corroboration only; annual effective-date rows establish dated input coverage. Release availability is not a legal effective date. No approval or complete shipment treatment is inferred.'});
   completed.push({name,chapter,id});await event({phase:'chapter_original',year:edition.year,name,chapter,id,bytes:bytes.length,pages,write});
  }catch(e){const failure={name,chapter,reason:e instanceof Error?e.message:String(e)};failures.push(failure);await event({phase:'failed',...failure});}}}));
 }
 const summary={write,editions:linked.size,chaptersRequested:chapters.length,completed,failures,customerWrites:0,models:0,approvals:0};await writeFile(resolve(dir,'summary.json'),JSON.stringify(summary,null,2));await event({phase:'finished',write,editions:linked.size,completed:completed.length,failures:failures.length});if(failures.length)process.exitCode=1;
}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1});
