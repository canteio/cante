/** Verify collected public evidence without importing it into a customer workspace. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {parseCsv} from '../lib/catalogue/csv';
import {parseBusinessImpact,evaluateBusinessImpact} from '../lib/tariff/business-impact';
const dir='scripts/test-fixtures/prusa-public';
async function main(){
 const report=JSON.parse(readFileSync(`${dir}/catalogue-source-report.json`,'utf8'));
 const index=JSON.parse(readFileSync(`${dir}/catalogue-url-index.json`,'utf8'));
 assert.equal(report.product_pages_attempted,index.urls.length);
 assert.equal(report.product_pages_extracted+report.failed_pages.length,index.urls.length);
 for(const source of report.sources.filter((s:{status:number})=>s.status===200)){
  const raw=gunzipSync(readFileSync(source.raw_file),{maxOutputLength:5000000});
  assert.equal(raw.length,source.bytes);
  assert.equal(createHash('sha256').update(raw).digest('hex'),source.sha256);
 }
 const products=parseCsv(readFileSync(`${dir}/catalogue-products.csv`,'utf8'));
 assert.equal(products.rows.length,report.distinct_published_product_uuids);
 assert.ok(products.rows.every(r=>!r.hts_code&&!r.country_of_origin&&!r.customs_value&&!r.paid_duty));
 let intake=0;
 for(const name of readdirSync(dir).filter(n=>/^catalogue-intake-\d+\.csv$/.test(n))){
  const text=readFileSync(`${dir}/${name}`,'utf8');assert.ok(Buffer.byteLength(text)<=2*1024*1024);
  const parsed=parseCsv(text);assert.ok(parsed.rows.length<=500);
  assert.ok(parsed.rows.every(r=>r.sku&&r.name&&!r.hts&&!r.origin_country));intake+=parsed.rows.length;
 }
 assert.equal(intake,products.rows.length);
 let calls=0;
 const results=await evaluateBusinessImpact(parseBusinessImpact(readFileSync(`${dir}/public-manifests.csv`,'utf8')),async()=>{calls++;throw Error('Incomplete manifest must not be calculated');});
 assert.equal(results.length,report.public_manifest_rows);assert.equal(calls,0);
 assert.ok(results.every(r=>r.status==='error'&&r.computed_total_rate===null&&r.annual_delta_usd===null));
 const verification={sitemap_urls_attempted:report.product_pages_attempted,pages_extracted:report.product_pages_extracted,distinct_catalogue_records:products.rows.length,raw_source_hashes_verified:true,catalogue_intake_rows:intake,public_manifest_rows:results.length,tariff_calculation_calls:calls,tenant_writes:0,llm_calls:0,full_public_sitemap_extracted:report.full_sitemap_extraction,complete_customs_ledger_obtained:false};
 writeFileSync(`${dir}/catalogue-verification.json`,JSON.stringify(verification,null,2));console.log(JSON.stringify(verification,null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
