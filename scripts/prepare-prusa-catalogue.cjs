/** Normalize the captured catalogue for product intake, not a customs audit. */
const fs=require('node:fs');const zlib=require('node:zlib');const {load}=require('cheerio');
const dir='scripts/test-fixtures/prusa-public';
const products=JSON.parse(fs.readFileSync('raw/prusa-catalogue/extracted-product-records.json','utf8'));
const unique=[...new Map(products.map(p=>[p.public_product_uuid??p.source_url,p])).values()];
function cell(v){let s=String(v??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
function csv(name,rows,cols){fs.writeFileSync(`${dir}/${name}`,[cols,...rows.map(r=>cols.map(c=>r[c]))].map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n');}
function reference(p){const offers=[...new Map(p.listed_offer_prices.filter(o=>o.price!==null&&o.price!==''&&Number.isFinite(Number(o.price))&&Number(o.price)>=0&&/^[A-Z]{3}$/.test(o.currency??'')).map(o=>[`${o.price}/${o.currency}`,o])).values()];return offers.length===1?offers[0]:null;}
const rows=unique.map(p=>({...p,retail_reference_price:reference(p)?.price??null,retail_currency:reference(p)?.currency??null,listed_offer_prices:JSON.stringify(p.listed_offer_prices),parameters:JSON.stringify(p.parameters),category_path:JSON.stringify(p.category_path),published_origin_claims:JSON.stringify(p.published_origin_claims)}));
csv('catalogue-products.csv',rows,['public_product_id','public_product_uuid','published_sku','name','description','brand','availability_text','retail_reference_price','retail_currency','listed_offer_prices','parameters','category_path','published_origin_claims','hts_code','country_of_origin','customs_value','paid_duty','source_url','final_url','retrieved_at','raw_file','sha256']);
const intake=rows.map(p=>({sku:p.published_sku||`PRUSA-PUBLIC-${p.public_product_uuid||p.public_product_id}`,name:p.name,hts:'',origin_country:'',unit_value:p.retail_reference_price??'',currency:p.retail_currency??'USD',description:p.description,notes:`PUBLIC RESEARCH: identifier generated from website UUID, not asserted as Prusa SKU. Unit value is published RETAIL reference price, NOT shipment customs value. No reviewed customs HTS or origin. Source ${p.source_url}`}));
for(let i=0;i<intake.length;i+=500)csv(`catalogue-intake-${String(i/500+1).padStart(2,'0')}.csv`,intake.slice(i,i+500),['sku','name','hts','origin_country','unit_value','currency','description','notes']);
const evidence=JSON.parse(fs.readFileSync(`${dir}/manifest-evidence.json`,'utf8'));
const $=load(zlib.gunzipSync(fs.readFileSync(evidence.source.raw_file)).toString('utf8'));
const table=$('table').toArray().find(table=>$(table).find('th').toArray().some(th=>$(th).text().trim()==='Estimated Arrival Date'));
if(!table)throw Error('Sample dates table missing');
const dates={};for(const row of $(table).find('tr').toArray()){const label=$(row).find('th').first().text().trim();if(label)dates[label]=$(row).find('td').first().text().trim();}
evidence.dates=dates;fs.writeFileSync(`${dir}/manifest-evidence.json`,JSON.stringify(evidence,null,2));
const manifest={entry_id:'',line_number:'',sku:'',hts:'',origin:'',customs_value:'',paid_duty:'',entry_date:'',master_bill_of_lading:evidence.bill['Master BOL #'],house_bill_of_lading:evidence.bill['House BOL #'],arrival_date:dates['Actual Arrival Date'],shipper:evidence.shipper['Shipper Name'],consignee:evidence.consignee['Consignee Name'],description:evidence.bill['Commodity Description'],gross_weight_reported:evidence.bill['Weight'],package_quantity_reported:evidence.bill['Quantity'],published_harmonized_fields:JSON.stringify(evidence.published_harmonized_fields),source_url:evidence.source.url,retrieved_at:evidence.source.retrieved_at,evidence_kind:'public_ocean_manifest_not_customs_entry'};
csv('public-manifests.csv',[manifest],Object.keys(manifest));
const report=JSON.parse(fs.readFileSync(`${dir}/catalogue-source-report.json`,'utf8'));
report.reference_price_records=rows.filter(p=>p.retail_reference_price!==null).length;
report.all_sitemap_urls_attempted=report.product_pages_attempted===report.sitemap_product_urls;
report.not_found_product_pages=report.failed_pages.filter(p=>p.error==='HTTP 404').length;
report.warranty_urls_returning_404=report.failed_pages.filter(p=>p.error==='HTTP 404'&&p.url.includes('warranty')).length;
fs.writeFileSync(`${dir}/catalogue-source-report.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({catalogueRecords:rows.length,referencePrices:report.reference_price_records,uploadBatches:Math.ceil(intake.length/500),manifestArrivalDate:dates['Actual Arrival Date'],tenantWrites:0}));
