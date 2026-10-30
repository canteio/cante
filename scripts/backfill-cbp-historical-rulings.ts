/** Immutable public government evidence only; no customer data or approvals.
 * Classification/holdings apply to the ruling's own facts, not our shipments. */
import {loadEnvConfig} from '@next/env';
import {createServiceClient} from '../lib/supabase/service';
import {fetchReference,referencePackage} from '../app/api/tariff/references/ingestion';
import {historicalOriginalText} from '../app/api/tariff/references/historical-contract';
import {HISTORICAL_CBP_RULINGS,validateCbpRuling} from '../app/api/tariff/references/cbp-guidance';
import {publishOfficialReference} from './publish-official-reference';
loadEnvConfig(process.cwd());
async function main(){
 const args=process.argv.slice(2);if(args.some(a=>a!=='--write'))throw Error('Use [--write]');const db=args.includes('--write')?createServiceClient():null;
 for(const item of HISTORICAL_CBP_RULINGS){const url=`https://rulings.cbp.gov/api/getdoc/${item.division}/${item.year}/${item.number}.pdf`,bytes=await fetchReference(url,2000000);if(!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('The public ruling is not its original PDF.');validateCbpRuling(await historicalOriginalText(bytes),item.number);
 const pack=referencePackage({kind:'legal_document',url,title:`CBP ${item.number}: illustrative historical duty allocation`,bytes,metadata:{role:'historical_cbp_ruling',rulingNumber:item.number,issuedOn:item.issuedOn,format:'pdf',scope:'Illustrative allocation corroboration only. Specific classifications, origin, exemptions and factual holdings are not applied to other goods.'}}),id=db?await publishOfficialReference(db,pack):null;console.log(JSON.stringify({number:item.number,id,sha256:pack.original_sha256,customerWrites:0,approvals:0}));}
}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1});
