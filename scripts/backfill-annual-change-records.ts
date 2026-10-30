/** Retain the official 2017 change record and its existing edition provenance.
 * Default is a read-only validation. --write captures evidence, never approval. */
import assert from 'node:assert/strict';
import {loadEnvConfig} from '@next/env';
import {createServiceClient} from '../lib/supabase/service';
import {fetchReference,referencePackage} from '../app/api/tariff/references/ingestion';
import {readReferenceBytes,digest,type ReferenceSource} from '../app/api/tariff/references/store';
import {ordinaryNotesText,proveAnnualScheduleChangeIdentity,proveAnnualScheduleChanges} from '../app/api/tariff/references/ordinary-contract';
import {publishOfficialReference} from './publish-official-reference';
loadEnvConfig(process.cwd());
async function main(){
 const args=process.argv.slice(2);assert(args.every(a=>a==='--write')&&args.length<=1,'Use [--write]');const write=args.includes('--write'),db=createServiceClient();
 const seed=await db.from('tariff_reference_catalogue').select('id,metadata').eq('metadata->>role','annual_schedule_chapter').eq('metadata->>annualScheduleYear','2017').eq('metadata->>publisherRelease','NTE').eq('metadata->>chapter','69').single();if(seed.error)throw seed.error;
 const m=seed.data.metadata as Record<string,unknown>,ids=[m.registryId,m.detailsId,m.archiveId];assert(ids.every(id=>typeof id==='string'));
 const parents=await Promise.all(ids.map(id=>readReferenceBytes(db,id as string))),[registry,details,archive]=parents;
 assert(registry.bytes.length<=2000000&&details.bytes.length<=2000000&&archive.bytes.length<=3000000);
 const url='https://hts.usitc.gov/reststop/file?release=NTE&filename=Change%20Record',bytes=await fetchReference(url,2000000);assert(bytes.subarray(0,5).toString()==='%PDF-');
 const text=await ordinaryNotesText(bytes),metadata={role:'annual_schedule_changes',annualScheduleYear:2017,publisherRelease:'NTE',registryId:m.registryId,detailsId:m.detailsId,archiveId:m.archiveId};
 const pack=referencePackage({kind:'legal_document',url,title:'USITC 2017 Revision 1: original dated change record',bytes,metadata});
 const validate=(source:Pick<ReferenceSource,'id'|'kind'|'url'|'metadata'>)=>{
  const identity=proveAnnualScheduleChangeIdentity({source,registrySource:registry.source,detailsSource:details.source,archiveSource:archive.source,registry:JSON.parse(registry.bytes.toString('utf8')),details:JSON.parse(details.bytes.toString('utf8')),archive:archive.bytes.toString('utf8')});assert(identity,'Edition/archive provenance must match');
  const changes=proveAnnualScheduleChanges({source,identity,text});assert(changes,'Complete original change-record contract must match');return changes;
 };
 const changes=validate({...pack,id:'READ-ONLY-VALIDATION'});let id:string|null=null;
 if(write){id=await publishOfficialReference(db,pack);const saved=await readReferenceBytes(db,id);assert.equal(digest(saved.bytes),digest(bytes));validate(saved.source);}
 console.log(JSON.stringify({sourceId:id,originalSha256:digest(bytes),bytes:bytes.length,restorations:changes.restorations,annotations:changes.annotations,undatedRestorations:changes.undatedRestorations,sourceCaptured:write,approvalsCreated:0,tenantWrites:0,models:0,limitation:'Dated original evidence only; rates, statistical classifications, shipment scope and calculation routing require separate validation.'}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Official change-record retention failed');process.exitCode=1;});
