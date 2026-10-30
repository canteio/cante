/** Explicit operator capture of public originals; no legal approvals or tenant writes. */
import{loadEnvConfig}from'@next/env';
import{fetchReference,referencePackage}from'../app/api/tariff/references/ingestion';
import{createServiceClient}from'../lib/supabase/service';
import{publishOfficialReference}from'./publish-official-reference';
loadEnvConfig(process.cwd());
async function main(){
 const args=process.argv.slice(2);if(args.some(a=>a!=='--write'))throw Error('Use [--write]');
 const db=args.includes('--write')?createServiceClient():null;
 const docs=[
 {number:'2025-19482',date:'2025-10-06',title:'Proclamation 10976: timber, lumber and derivative products',url:'https://www.govinfo.gov/content/pkg/FR-2025-10-06/pdf/2025-19482.pdf'},
 {number:'2026-00327',date:'2026-01-09',title:'Proclamation 11000: postponement of wood duty increases',url:'https://www.govinfo.gov/content/pkg/FR-2026-01-09/pdf/2026-00327.pdf'},
 {number:'2026-10571',date:'2026-05-28',title:'Implementing tariff-related Taiwan trade and security elements',url:'https://www.govinfo.gov/content/pkg/FR-2026-05-28/pdf/2026-10571.pdf'},
 ];
 for(const d of docs){const bytes=await fetchReference(d.url,3000000);if(bytes.subarray(0,5).toString()!=='%PDF-')throw Error('Official enactment is not a PDF');const pack=referencePackage({kind:'legal_document',url:d.url,title:d.title,bytes,metadata:{documentNumber:d.number,publicationDate:d.date,scope:'Public evidence only; effective dates and legal scope require deterministic source interpretation.'}});const id=db?await publishOfficialReference(db,pack):null;console.log(JSON.stringify({document:d.number,id,sha256:pack.original_sha256,bytes:bytes.length}));}
 const url='https://content.govdelivery.com/accounts/USDHSCBP/bulletins/4193d0a',bytes=await fetchReference(url,1000000),pack=referencePackage({kind:'legal_document',url,title:'CBP CSMS 68762890: Taiwan Section 232 instructions',bytes,metadata:{role:'historical_cbp_guidance',csms:'68762890',scope:'Public evidence only; no automatic shipment qualification or legal approval.'}}),id=db?await publishOfficialReference(db,pack):null;console.log(JSON.stringify({csms:'68762890',id,sha256:pack.original_sha256,bytes:bytes.length}));
 console.log(JSON.stringify({sourceWrites:db?4:0,tenantWrites:0,models:0,approvals:0}));
}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1});
