/** Operator-only capture of CBP's dated implementation chart. Government
 * evidence only: this never writes customers, approvals or calculated rates. */
import {loadEnvConfig} from '@next/env';
import {createServiceClient} from '../lib/supabase/service';
import {fetchReference,referencePackage} from '../app/api/tariff/references/ingestion';
import {SECTION301_CHART_URL,readSection301Chart} from '../app/api/tariff/references/section301-chart';
import {publishOfficialReference} from './publish-official-reference';
loadEnvConfig(process.cwd());
async function main(){
 const args=process.argv.slice(2);if(args.some(a=>a!=='--write'))throw Error('Use [--write]');
 const bytes=await fetchReference(SECTION301_CHART_URL,3000000),windows=await readSection301Chart(bytes,'PREVIEW');
 const pack=referencePackage({kind:'legal_document',url:SECTION301_CHART_URL,title:'CBP Section 301 tranches and exclusion rounds chart — August 28, 2025',bytes,metadata:{role:'cbp_section301_chart',publicationDate:'2025-08-28',scope:'Initial whole-heading windows only; partial extensions require their own dated scope.',compiler:'cbp-301-chart-v1'}});
 const id=args.includes('--write')?await publishOfficialReference(createServiceClient(),pack):null;
 console.log(JSON.stringify({write:!!id,id,windows:windows.length,sha256:pack.original_sha256,legalApprovalsCreated:0,customerWrites:0}));
}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
