/** Read-only verification against real collected records; no tenant writes or paid calls. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { parseCsv } from '../lib/catalogue/csv';
import { parseStackRequestRows } from '../lib/tariff/bulk';
import { parseBusinessImpact, evaluateBusinessImpact } from '../lib/tariff/business-impact';
const dir='scripts/test-fixtures/lulzbot-public-research';
async function main() {
 const summary=JSON.parse(readFileSync(`${dir}/summary.json`,'utf8'));
 const products=parseCsv(readFileSync(`${dir}/products.csv`,'utf8'));
 assert.equal(products.rows.length,summary.variants);
 assert.equal(new Set(products.rows.map(r=>r.variant_id)).size,summary.variants);
 assert.equal(new Set(products.rows.map(r=>r.product_id)).size,summary.products);
 assert.ok(products.rows.every(r=>!r.hts_code&&!r.country_of_origin&&!r.customs_value_usd&&!r.paid_duty_usd));
 const parts=parseCsv(readFileSync(`${dir}/bom-parts.csv`,'utf8'));
 assert.equal(parts.rows.length,summary.distinct_published_part_identifiers);
 assert.equal(new Set(parts.rows.map(r=>r.sku)).size,parts.rows.length);
 let rejectedParts=0;
 for(const name of readdirSync(dir).filter(n=>/^calculator-intake-\d+\.csv$/.test(n)).sort()) {
  const csv=readFileSync(`${dir}/${name}`,'utf8');const source=parseCsv(csv);
  assert.ok(source.rows.length<=500);
  const parsed=parseStackRequestRows(csv);
  assert.equal(parsed.rows.length,0);
  assert.equal(parsed.errors.length,source.rows.length);
  assert.ok(parsed.errors.every(error=>/HTS/.test(error.reason)));
  rejectedParts+=parsed.errors.length;
 }
 assert.equal(rejectedParts,summary.distinct_published_part_identifiers);
 const text=readFileSync(`${dir}/public-manifests.csv`,'utf8');
 const raw=parseCsv(text);assert.equal(raw.rows.length,10);
 assert.ok(raw.rows.every(row=>row.gross_weight_reported&&row.package_quantity_reported));
 let calculationCalls=0;
 const evaluated=await evaluateBusinessImpact(parseBusinessImpact(text),async ()=>{calculationCalls++;throw Error('Incomplete public evidence must never reach the duty calculator');});
 assert.equal(calculationCalls,0);
 assert.ok(evaluated.every(row=>row.status==='error'&&row.computed_total_rate===null&&row.annual_delta_usd===null));
 const report={catalogue_products:summary.products,catalogue_variants:products.rows.length,distinct_bom_identifiers:parts.rows.length,calculator_rows_honestly_rejected:rejectedParts,public_manifests_retained:evaluated.length,tariff_calculation_calls:calculationCalls,computed_duties:0,tenant_writes:0,llm_calls:0,tariff_accuracy_verified:false,reason:'No broker-reviewed HTS, legal entry date, customs value, duty paid or qualification was supplied.'};
 writeFileSync(`${dir}/verification.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1});
