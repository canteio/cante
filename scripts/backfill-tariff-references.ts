import "./load-env";
import {loadEnvConfig} from "@next/env";
import { mkdirSync,writeFileSync } from "node:fs";
import { createServiceClient } from "../lib/supabase/service";
import { archivePage,fetchReference,normalizeReleases,projectHistoricalRates,referencePackage,registryUrl,officialReferenceUrl } from "../app/api/tariff/references/ingestion";
loadEnvConfig(process.cwd());

const args=process.argv.slice(2),write=args.includes("--write"),existing=args.includes("--capture-existing");
const documents=args.find(a=>a.startsWith("--documents="))?.slice(12).split(",")??[];
const pages=args.find(a=>a.startsWith("--pages="))?.slice(8).split(",")??[];
if(args.some(a=>a!=="--write"&&a!=="--capture-existing"&&!a.startsWith("--pages=")&&!a.startsWith("--documents="))||pages.length>20||documents.length>10||documents.some(n=>!/^\d{4}-\d+$/.test(n)))throw Error("Usage: node --import tsx scripts/backfill-tariff-references.ts --pages=<official-edition-page,...> [--capture-existing] [--write]");
async function main(){
 const db=write||existing?createServiceClient():null,registry=await fetchReference(registryUrl,2000000),releases=normalizeReleases(JSON.parse(registry.toString("utf8")));
 if(write){const result=await db!.from("tariff_reference_releases").upsert(releases,{onConflict:"name"});if(result.error)throw result.error;}
 const summary:{kind:string;release?:string;rows:number;bytes:number;id?:string}[]=[];
 async function save(source:ReturnType<typeof referencePackage>,rates:ReturnType<typeof projectHistoricalRates>=[]){
  let id:string|undefined;if(write){
   const packageSource = rates.length ? {...source,metadata:{...source.metadata,expectedRateCount:rates.length}} : source;
   const result=await db!.rpc("publish_tariff_reference",{source:packageSource,rates:[]});
   if(result.error)throw Error(`Reference publish failed: ${result.error.message}`);id=result.data;
   if(rates.length){
    for(let i=1;i<=99;i++){
     const chapter=String(i).padStart(2,"0"),rows=rates.filter(r=>r.hts.startsWith(chapter)).sort((a,b)=>a.hts.localeCompare(b.hts));
     const published=await db!.rpc("publish_tariff_reference_chapter",{target_source:id,target_chapter:chapter,chapter_rows:rows});
     if(published.error)throw Error(`Chapter ${chapter} publish failed: ${published.error.message}`);
    }
    const complete=await db!.from("tariff_reference_catalogue").select("projection_complete").eq("id",id).single();
    if(complete.error||complete.data?.projection_complete!==true)throw Error("Historical projection remains incomplete.");
   }
  }
  summary.push({kind:source.kind,...(source.release_name?{release:source.release_name}:{}),rows:rates.length,bytes:source.original_bytes,...(id?{id}:{})});
 }
 await save(referencePackage({kind:"release_registry",url:registryUrl,title:"Official USITC release availability registry",bytes:registry,metadata:{releases}}));
 const failed:string[]=[];
 for(const number of documents){
  const meta=JSON.parse((await fetchReference(`https://www.federalregister.gov/api/v1/documents/${number}.json`,2000000)).toString("utf8"));
  if(meta.document_number!==number||typeof meta.pdf_url!=="string")throw Error("Official document identity missing.");
  const metadata={documentNumber:number,publicationDate:meta.publication_date,effectiveOn:meta.effective_on??null,datesText:meta.dates??null,htmlUrl:meta.html_url};
  let pack:ReturnType<typeof referencePackage>;
  try{const bytes=await fetchReference(meta.pdf_url,25000000);if(!bytes.subarray(0,5).equals(Buffer.from("%PDF-")))throw Error("Official original is not PDF.");pack=referencePackage({kind:"legal_document",url:meta.pdf_url,title:String(meta.title).slice(0,300),bytes,metadata});}
  catch(error){if(typeof meta.raw_text_url!=="string")throw error;const bytes=await fetchReference(meta.raw_text_url,2500000);const text=bytes.toString('utf8');if(!text.includes(number)||/<html/i.test(text))throw Error('Official text identity missing or access page returned');pack=referencePackage({kind:'legal_document',url:meta.raw_text_url,title:String(meta.title).slice(0,300),bytes,metadata:{...metadata,format:'official_text',originalPdfUrl:meta.pdf_url,pdfCaptureFailure:error instanceof Error?error.message:'PDF unavailable'}});}
  await save(pack);
 }

 for(const page of pages){try{
  officialReferenceUrl(page);const html=await fetchReference(page,3000000),links=archivePage(html.toString("utf8"),page),release=releases.find(r=>r.name===links.release);if(!release)throw Error("Edition absent from official registry.");
  const original=await fetchReference(links.json),rates=projectHistoricalRates(JSON.parse(original.toString("utf8")));
  const metadata={editionPage:page,editionPageSha256:referencePackage({kind:"legal_document",url:page,title:"Edition page",bytes:html}).original_sha256,release,modifyingDocuments:links.notices,projectionVersion:"hts-leaves-v1",availabilityIsLegalEffectiveDate:false};
  await save(referencePackage({kind:"hts_json",url:links.json,title:release.description+": original JSON schedule",bytes:original,release_name:release.name,metadata}),rates);
  const detailsUrl=`https://hts.usitc.gov/reststop/releaseDetails?release=${release.name}`,details=JSON.parse((await fetchReference(detailsUrl,2000000)).toString("utf8"));
  if(details.reldetail?.name!==release.name||!Object.prototype.hasOwnProperty.call(details.pdfList??{},"Chapter 99_III"))throw Error("Historical legal-note file is absent from edition metadata.");
  const pdfUrl=`https://hts.usitc.gov/reststop/file?release=${release.name}&filename=Chapter%2099_III`,pdf=await fetchReference(pdfUrl);
  if(!pdf.subarray(0,5).equals(Buffer.from("%PDF-")))throw Error("Historical legal-note source is not PDF.");
  const {getDocumentProxy,extractText}=await import("unpdf");const doc=await getDocumentProxy(new Uint8Array(pdf));if(doc.numPages>700)throw Error("Legal-note PDF exceeds page limit.");const text=(await extractText(doc,{mergePages:true})).text;const revision=/Revision\s+(\d+)/i.exec(release.description)?.[1],year=release.name.slice(0,4);
  if(!revision||!text.includes(`Harmonized Tariff Schedule of the United States Revision ${revision} (${year})`))throw Error("Historical PDF revision identity mismatch.");
  await save(referencePackage({kind:"chapter99_pdf",url:pdfUrl,title:release.description+": Chapter 99 legal notes",bytes:pdf,release_name:release.name,metadata:{release,revisionVerified:true,pageCount:doc.numPages}}));
  for(const url of links.notices.slice(0,8)){
   const number=/\/(\d{4}-\d+)(?:\/|$)/.exec(url)?.[1];if(!number)continue;
   try{const meta=JSON.parse((await fetchReference(`https://www.federalregister.gov/api/v1/documents/${number}.json`,2000000)).toString("utf8"));if(meta.document_number!==number||typeof meta.pdf_url!=="string")throw Error("Amendment identity or original PDF missing.");const pdf=await fetchReference(meta.pdf_url,10000000);if(!pdf.subarray(0,5).equals(Buffer.from("%PDF-")))throw Error("Amendment source is not PDF.");
    await save(referencePackage({kind:"legal_document",url:meta.pdf_url,title:String(meta.title).slice(0,300),bytes:pdf,release_name:release.name,metadata:{documentNumber:number,publicationDate:meta.publication_date,effectiveOn:meta.effective_on??null,datesText:meta.dates??null,htmlUrl:meta.html_url}}));
   }catch(e){failed.push(`Amendment ${number}: ${e instanceof Error?e.message.slice(0,400):"capture failed"}`);}
  }
  console.log(JSON.stringify({captured:release.name,rateRows:rates.length,write}));
 }catch(e){failed.push(`${page}: ${e instanceof Error?e.message.slice(0,400):"capture failed"}`);}}
 if(existing){
  for(const [table,kind,fields] of [
   ["hts_schedule_embeddings","legacy_hts","hts_code,general,special,other,additional_duties,units,hts_revision"],
   ["section232_tariff_rows","legacy_section232","source_document_number,source_pdf_url,annex,hts_prefix,rate_percent,uk_rate_percent,us_content_rate_percent,status,subheading,effective_date,verification_pass"],
   ["tariff_stacking_rules","legacy_stacking","id,target_measure,action,cap_rate_percent,conditions,priority,rule_text,citation,effective_date,expires_date,tier,confirmed_by,superseded_by,precedence_over,precedence_reason"]
  ] as const){const rows:unknown[]=[];for(let offset=0;offset<100000;offset+=500){const result=await db!.from(table as string).select(fields as string).order(table==="hts_schedule_embeddings"?"hts_code":"id").range(offset,offset+499);if(result.error)throw result.error;rows.push(...(result.data??[]));if((result.data?.length??0)<500)break;}
   if(rows.length>=100000)throw Error("Existing reference capture exceeds its record budget.");
   await save(referencePackage({kind,url:`urn:cante:legacy:${table}`,title:`Preserved existing ${table} reference records`,bytes:Buffer.from(JSON.stringify(kind==="legacy_stacking"?rows.map(row=>{const {confirmed_by,...publicRow}=row as Record<string,unknown>;return {...publicRow,confirmed:confirmed_by!=null};}):rows)),metadata:{originTable:table,rows:rows.length,classification:"Legacy observation; stored review labels are not new legal approval."}}));
  }
 }
 mkdirSync("raw/tariff-references",{recursive:true});writeFileSync("raw/tariff-references/backfill-summary.json",JSON.stringify({write,registryReleases:releases.length,summary,failed},null,2));
 console.log(JSON.stringify({write,registryReleases:releases.length,sourceCount:summary.length,totalRateRows:summary.reduce((n,r)=>n+r.rows,0),failed},null,2));if(failed.length)process.exitCode=1;
}
void main().catch(e=>{console.error(e instanceof Error?e.message:"Reference backfill failed");process.exitCode=1;});
