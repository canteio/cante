/** Public CBP originals only. No ACE account, customer data or legal approvals.
 * Captures the complete bounded case index and its public cash-deposit messages.
 * Scope, injunction and final-assessment interpretation remain separate work. */
import {loadEnvConfig}from'@next/env';
import {createServiceClient}from'../lib/supabase/service';
import {ADCVD_PUBLIC_API,adcvdCase,adcvdIndex,adcvdHeader,adcvdBody,cbpMessageDate,publicAdcvdSession}from'../app/api/tariff/references/adcvd-source';
import {referencePackage}from'../app/api/tariff/references/ingestion';
import {publishOfficialReference}from'./publish-official-reference';
loadEnvConfig(process.cwd());
async function main(){
 const args=process.argv.slice(2),arg=args.find(a=>a.startsWith('--case='));if(!arg||args.some(a=>a!==arg&&a!=='--write'))throw Error('Use --case=A-000-000 [--write]');
 const root=adcvdCase(arg.slice(7));if(root.length!==7)throw Error('Capture the root AD/CVD case, not a company suffix.');
 const db=args.includes('--write')?createServiceClient():null,read=await publicAdcvdSession(),indexUrl=ADCVD_PUBLIC_API+'quickSearchMessage-MemorySide/'+root,indexBytes=await read(indexUrl),index=adcvdIndex(JSON.parse(indexBytes.toString('utf8')),root);
 const save=async(url:string,title:string,bytes:Buffer,metadata:Record<string,unknown>)=>{const pack=referencePackage({kind:'legal_document',url,title,bytes,metadata:{role:'cbp_adcvd_original',caseNumber:root,...metadata,scope:'Public evidence only; no scope determination, legal approval or final assessment inferred.'}}),id=db?await publishOfficialReference(db,pack):null;console.log(JSON.stringify({part:metadata.part,imn:metadata.imn??null,id,sha256:pack.original_sha256,bytes:bytes.length}));return id;};
 const indexId=await save(indexUrl,`CBP public AD/CVD case ${root} message index`,indexBytes,{part:'index',complete:true,totalMessages:index.rows.length});
 const messages=index.rows.filter(r=>r.type==='CD-Cash Deposit');if(messages.length>100)throw Error('Cash-deposit capture exceeds the 100-message operator bound. Split with a reviewed dated capture.');
 for(const row of messages){
  const headerUrl=ADCVD_PUBLIC_API+'getMessageHeaderDetails/'+row.imn,headerBytes=await read(headerUrl),header=adcvdHeader(JSON.parse(headerBytes.toString('utf8')),row,root),bodyUrl=ADCVD_PUBLIC_API+'getMsgBody/'+row.imn,bodyBytes=await read(bodyUrl);adcvdBody(JSON.parse(bodyBytes.toString('utf8')));
  const metadata={imn:row.imn,messageNumber:row.messageNumber,messageType:row.type,messageDate:cbpMessageDate(row.messageDate),effectiveDate:cbpMessageDate(header.effectiveDate),status:row.status,caseIndexId:indexId};
  const headerId=await save(headerUrl,`CBP AD/CVD ${root} message ${row.messageNumber} header`,headerBytes,{...metadata,part:'header'});
  await save(bodyUrl,`CBP AD/CVD ${root} message ${row.messageNumber} body`,bodyBytes,{...metadata,part:'body',headerId});
 }
 console.log(JSON.stringify({caseNumber:root,completePublicIndex:true,indexMessages:index.rows.length,capturedCashDepositMessages:messages.length,customerWrites:0,models:0,approvals:0,limitation:'Other message bodies and final assessment instructions are not captured by this command. No duty calculation or blanket case coverage is established.'}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
