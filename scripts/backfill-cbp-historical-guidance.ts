/** Immutable official CBP guidance only: no customers, rule approvals or jobs. */
import {loadEnvConfig} from '@next/env';
import {createServiceClient} from '../lib/supabase/service';
import {fetchReference,referencePackage} from '../app/api/tariff/references/ingestion';
import {HISTORICAL_CBP_GUIDANCE,cbpGuidanceText} from '../app/api/tariff/references/cbp-guidance';
import {publishOfficialReference} from './publish-official-reference';
loadEnvConfig(process.cwd());
async function main(){
 const args=process.argv.slice(2);if(args.some(a=>a!=='--write'&&!/^--numbers=\d{8}(?:,\d{8})*$/.test(a)))throw Error('Use [--write] [--numbers=CSMS,...]');const db=args.includes('--write')?createServiceClient():null,numbers=args.find(a=>a.startsWith('--numbers='))?.slice(10).split(',');if(numbers?.some(n=>!HISTORICAL_CBP_GUIDANCE.some(g=>g.number===n)))throw Error('Unknown original guidance number.');
 for(const item of HISTORICAL_CBP_GUIDANCE.filter(g=>!numbers||numbers.includes(g.number))){const url=`https://content.govdelivery.com/accounts/USDHSCBP/bulletins/${item.bulletin}`,bytes=await fetchReference(url,1000000);cbpGuidanceText(bytes,item.number);
 const pack=referencePackage({kind:'legal_document',url,title:`CBP CSMS ${item.number}: historical tariff implementation guidance`,bytes,metadata:{role:'historical_cbp_guidance',csms:item.number,format:'html',scope:'Retained original government guidance, not human approval or shipment qualification.'}}),id=db?await publishOfficialReference(db,pack):null;console.log(JSON.stringify({number:item.number,id,sha256:pack.original_sha256,customerWrites:0,approvals:0}));}
}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
