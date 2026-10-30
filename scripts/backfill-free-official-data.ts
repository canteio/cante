/** Public government evidence only. No tenant imports, approvals, models,
 * new schedules or privileged website credentials. --write publishes sources. */
import {loadEnvConfig} from '@next/env';
import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {annualDownloads,annualManifestUrl,annualCodeKeyUrl,annualFieldsUrl,annualRows} from '../app/api/tariff/references/annual-data';
import {federalTariffSearch,federalTariffPage,federalXmlAlternative} from '../app/api/tariff/references/official-api';
import {fetchReference,officialReferenceUrl,referencePackage} from '../app/api/tariff/references/ingestion';
import {digest} from '../app/api/tariff/references/store';
import {publishOfficialReference} from './publish-official-reference';
import {createServiceClient} from '../lib/supabase/service';
loadEnvConfig(process.cwd());
const args=process.argv.slice(2),write=args.includes('--write');
if(args.some(a=>a!=='--write'&&a!=='--refresh'&&!a.startsWith('--years=')&&!a.startsWith('--legal-years=')&&!a.startsWith('--documents=')))throw Error('Use [--write] [--refresh] [--years=2000-2026|none] [--legal-years=2025,2026|none] [--documents=publisher-number,...]');
const requestedDocuments=args.find(a=>a.startsWith('--documents='))?.slice(12).split(',')??[];if(requestedDocuments.length>50||requestedDocuments.some(n=>!/^\d{4}-\d{4,6}$/.test(n)))throw Error('Invalid explicit document selection.');
function years(value:string){if(value==='none')return [];const all=value.split(',').flatMap(s=>{const m=/^(\d{4})(?:-(\d{4}))?$/.exec(s);if(!m)throw Error('Invalid year selection.');const from=Number(m[1]),through=Number(m[2]??m[1]);if(from<1997||through>new Date().getUTCFullYear()||from>through)throw Error('Unsupported year selection.');return Array.from({length:through-from+1},(_,i)=>from+i);});if(new Set(all).size!==all.length||all.length>35)throw Error('Duplicate/excessive year selection.');return all;}
const selected=years(args.find(a=>a.startsWith('--years='))?.slice(8)??`2000-${new Date().getUTCFullYear()}`),legal=years(args.find(a=>a.startsWith('--legal-years='))?.slice(14)??'2025,2026');
const directory=resolve('raw/tariff-references/free-official'),db=write?createServiceClient():null;
const failures:{item:string;reason:string}[]=[],annual:{year:number;records:number;id:string|null}[]=[],documents=new Set<string>();
const sourceGaps:{document:string;reason:string}[]=[];let xmlRenditions=0;
async function event(value:Record<string,unknown>){const line=JSON.stringify({at:new Date().toISOString(),...value});console.log(line);await appendFile(resolve(directory,'events.ndjson'),line+'\n');}
async function cached(url:string,max=25000000,refresh=false){officialReferenceUrl(url);const file=resolve(directory,digest(url)+'.bin');if(!refresh&&!args.includes('--refresh'))try{const b=await readFile(file);if(b.length>max)throw Error('Cached source exceeds bounds.');return b;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}const b=await fetchReference(url,max);await writeFile(file,b);return b;}
async function capture(url:string,title:string,bytes:Buffer,metadata:Record<string,unknown>){const pack=referencePackage({kind:'legal_document',url,title,bytes,metadata,external:true});return db?publishOfficialReference(db,pack):null;}
async function captureDocument(doc:ReturnType<typeof federalTariffPage>['documents'][number],year:number){
 if(documents.has(doc.documentNumber))return;
 const metadata={documentNumber:doc.documentNumber,publicationDate:doc.publicationDate,effectiveOn:doc.effectiveOn,htmlUrl:doc.htmlUrl,discoveryYear:year,discoveryOnly:true,scope:'Search discovery only; no entry applicability or approved rule inferred.'};
 try{const original=await cached(doc.url);if(!original.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('Original legal document is not PDF.');await capture(doc.url,doc.title,original,metadata);}
 catch(error){if(!String(error).includes('exceeds its capture limit'))throw error;
  const meta=JSON.parse((await cached(`https://www.federalregister.gov/api/v1/documents/${doc.documentNumber}.json`,2000000)).toString('utf8')),url=federalXmlAlternative(meta,doc.documentNumber),bytes=await cached(url);
  const text=bytes.toString('utf8');if(!/^\s*<(?:NOTICE|RULE|PRESDOCU|DOC|\?xml)\b/.test(text)||!text.includes(doc.documentNumber))throw Error('XML rendition identity was not established.');
  const reason='Original PDF exceeds the 25 MB cap. XML rendition retained; linked graphics/annex images are not captured and may contain essential scope.';
  await capture(url,doc.title,bytes,{...metadata,format:'federal_register_xml',unretainedPdf:doc.url,sourceLimitation:reason});sourceGaps.push({document:doc.documentNumber,reason});xmlRenditions++;
 }
 documents.add(doc.documentNumber);
}
async function main(){
 await mkdir(directory,{recursive:true});
 const manifest=await fetchReference(annualManifestUrl,100000),downloads=annualDownloads(JSON.parse(manifest.toString('utf8')));
 await capture(annualManifestUrl,'USITC annual tariff download directory',manifest,{role:'annual_tariff_directory',format:'json',discoveryOnly:true});
 for(const [url,title,role]of [[annualCodeKeyUrl,'USITC annual tariff code key','annual_tariff_code_key'],[annualFieldsUrl,'USITC annual tariff field definitions','annual_tariff_fields']]){const bytes=await cached(url);if(!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('Annual field documentation is not PDF.');await capture(url,title,bytes,{role,format:'pdf'});}
 for(const year of selected)try{const download=downloads.find(d=>d.year===year);if(!download)throw Error('No publisher-linked annual archive for this year.');const bytes=await cached(download.url,25000000,year===new Date().getUTCFullYear()),rows=annualRows(bytes,year),id=await capture(download.url,`USITC annual tariff database ${year}`,bytes,{annualTariffYear:year,format:'zip',projectionVersion:'annual-legal-line-v1',recordCount:rows.length,invalidDateRecords:rows.filter(r=>r.issue).length,scope:'8-digit legal tariff-line evidence only; no automatic legal approval or complete entry duty.'});annual.push({year,records:rows.length,id});await event({phase:'annual_complete',year,records:rows.length,write});}catch(error){failures.push({item:String(year),reason:String(error)});await event({phase:'annual_failed',year,reason:String(error)});}
 for(const year of legal){let count=0;try{for(let page=1;page<=10;page++){
  const url=federalTariffSearch(year,page),bytes=await cached(url,3000000,true),result=federalTariffPage(JSON.parse(bytes.toString('utf8')),year);if(result.pages>10)throw Error('Official discovery exceeds 1,000 documents per year; narrow the search before continuing.');
  await capture(url,`Federal Register tariff search ${year}, page ${page}`,bytes,{role:'tariff_document_discovery',format:'json',searchYear:year,documentCount:result.count,discoveryOnly:true});
  for(const doc of result.documents){if(documents.has(doc.documentNumber))continue;try{await captureDocument(doc,year);count++;}catch(error){failures.push({item:doc.documentNumber,reason:String(error)});}}
  await event({phase:'legal_page_complete',year,page,documents:result.documents.length,write});if(page>=result.pages)break;
 }}catch(error){failures.push({item:`legal:${year}`,reason:String(error)});}await event({phase:'legal_year_complete',year,captured:count,write});}
 for(const number of requestedDocuments)try{const meta=JSON.parse((await cached(`https://www.federalregister.gov/api/v1/documents/${number}.json`,2000000)).toString('utf8')),year=Number(String(meta.publication_date).slice(0,4)),result=federalTariffPage({count:1,total_pages:1,results:[meta]},year);if(result.documents[0].documentNumber!==number)throw Error('Requested document identity differs.');await captureDocument(result.documents[0],year);}catch(error){failures.push({item:number,reason:String(error)});}
 const summary={write,annual,legalDocuments:documents.size,xmlRenditions,sourceGaps,failures,limitation:'Annual data and keyword discovery are source evidence, not exhaustive legislation, human approval or full historical duty coverage.',finishedAt:new Date().toISOString()},receipt=JSON.stringify(summary,null,2);await writeFile(resolve(directory,'summary.json'),receipt);await writeFile(resolve(directory,'summary-'+summary.finishedAt.replace(/[:.]/g,'-')+'.json'),receipt,{flag:'wx'});await event({phase:'finished',annualYears:annual.length,legalDocuments:documents.size,xmlRenditions,failures:failures.length,write});if(failures.length)process.exitCode=1;
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
