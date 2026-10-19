/** Public HTML only: no paid API, credentials, or access-control bypass. */
import { load } from 'cheerio';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const out='scripts/test-fixtures/lulzbot-public-research';
const raw='raw/lulzbot-public-research';
const cell=(v: unknown)=>`"${String(v??'').replace(/"/g,'""')}"`;
async function main() {
 await mkdir(out,{recursive:true});await mkdir(raw,{recursive:true});
 const url='https://www.importgenius.com/importers/aleph-objects-inc';
 const response=await fetch(url,{signal:AbortSignal.timeout(25000)});
 if(!response.ok)throw Error(`Public manifest source HTTP ${response.status}`);
 const body=await response.text(); if(Buffer.byteLength(body)>2_000_000)throw Error('Manifest source exceeds bound');
 const $=load(body);const fetchedAt=new Date().toISOString();
 await writeFile(`${raw}/aleph-objects-public.html`,body);
 const rows:Record<string,string>[]=[];
 $('table').each((_,table)=>{
  if(!$(table).find('td[data-title="Bill of Lading"]').length)return;
  $(table).find('tbody tr').each((_,tr)=>{
   const get=(label:string)=>$(tr).find("td").filter((_,td)=>(($(td).attr("data-title")??"").toLowerCase()===label.toLowerCase())).text().replace(/\s+/g,' ').trim();
   if(!get('Bill of Lading'))return;
   rows.push({entry_id:'',line_number:'',sku:'',hts:'',origin:'',customs_value:'',paid_duty:'',entry_date:'',bill_of_lading:get('Bill of Lading'),arrival_date:get('Arrival Date'),description:get('Product'),importer:get('Consignee')||get('Importer'),supplier:get('Shipper')||get('Supplier'),reported_country:get('Country of Origin'),gross_weight_reported:get('Gross Weight KGS'),package_quantity_reported:get('Quantity'),source_url:url,retrieved_at:fetchedAt,evidence_kind:'public_ocean_manifest_not_customs_entry'});
  });
 });
 if(!rows.length)throw Error('No public shipment table; do not substitute a demo');
 if(new Set(rows.map(r=>r.bill_of_lading)).size!==rows.length)throw Error('Repeated B/L in public table');
 const columns=Object.keys(rows[0]);await writeFile(`${out}/public-manifests.csv`,[columns,...rows.map(r=>columns.map(c=>r[c]))].map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n');
 const suppliers:Record<string,string>[]=[];
 $('table').each((_,table)=>{
  const heads=$(table).find('th').map((_,th)=>$(th).text().trim()).get();
  if(!heads.includes('Supplier')||!heads.includes('No. of Containers'))return;
  $(table).find('tbody tr').each((_,tr)=>{
   const values=$(tr).find('td').map((_,td)=>$(td).text().replace(/\s+/g,' ').trim()).get();
   if(values.length!==heads.length)return;
   suppliers.push({...Object.fromEntries(heads.map((h,i)=>[h,values[i]])),source_url:url,retrieved_at:fetchedAt});
  });
 });
 await writeFile(`${out}/manifest-suppliers.json`,JSON.stringify(suppliers,null,2));
 await writeFile(`${out}/manifest-source-report.json`,JSON.stringify({source_url:url,retrieved_at:fetchedAt,sha256:createHash('sha256').update(body).digest('hex'),public_rows:rows.length,reported_total_shipments:$('meta[property="total-shipments"]').attr('content')??null,available_hs_code:$.text().includes('HS-Code DATA UNAVAILABLE')?'unavailable':'No verified HTS field extracted',limitations:['Public sample rows only, not full shipment history','Reported country is not a reviewed customs origin','Arrival is not legal entry date; gross weight and packages are not tariff quantity','No published SKU, exact HTS, customs value, duty paid or qualification']},null,2));
 console.log(JSON.stringify({publicShipmentRows:rows.length,publicSuppliers:suppliers.length,reportedTotal:$('meta[property="total-shipments"]').attr('content')}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
