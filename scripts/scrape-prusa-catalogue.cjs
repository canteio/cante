/** Public storefront and visible manifest evidence only. No LLM or tenant writes. */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const {load}=require('cheerio');
const base=path.resolve(__dirname,'..');
const raw=path.join(base,'raw/prusa-catalogue');
const out=path.join(base,'scripts/test-fixtures/prusa-public');
fs.mkdirSync(raw,{recursive:true});fs.mkdirSync(out,{recursive:true});
const sources=[],products=[],failures=[];
let totalBytes=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
async function get(url) {
 const record={url,retrieved_at:new Date().toISOString()};
 try {
  if(!['www.prusa3d.com','www.importinfo.com'].includes(new URL(url).hostname))throw Error('Outside allowed public sources');
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
  record.status=response.status;record.final_url=response.url;
  if(!response.ok)throw Error(`HTTP ${response.status}`);
  if(!['www.prusa3d.com','www.importinfo.com'].includes(new URL(response.url).hostname))throw Error('Unexpected redirect host');
  const chunks=[];let bytes=0;
  for await(const chunk of response.body){bytes+=chunk.length;if(bytes>5000000)throw Error('Page exceeds 5 MB bound');chunks.push(chunk);}
  const body=Buffer.concat(chunks);totalBytes+=bytes;
  if(totalBytes>1500000000)throw Error('Run exceeds 1.5 GB transfer bound');
  const file=path.join(raw,digest(Buffer.from(url))+'.html.gz');fs.writeFileSync(file,zlib.gzipSync(body));
  Object.assign(record,{bytes,sha256:digest(body),raw_file:path.relative(base,file)});sources.push(record);
  return {body:body.toString('utf8'),record};
 }catch(error){record.error=error.message;sources.push(record);throw error;}
}
function csvCell(v){let s=String(v??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
function csv(name,rows,columns){fs.writeFileSync(path.join(out,name),[columns,...rows.map(r=>columns.map(c=>r[c]))].map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n');}
function text(html){return load(String(html??'')).text().replace(/\s+/g,' ').trim();}
function schemas($){const found=[];for(const e of $('script[type="application/ld+json"]').toArray()){try{const walk=v=>{if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object'){if(v['@type']==='Product')found.push(v);if(v['@graph'])walk(v['@graph']);}};walk(JSON.parse($(e).text()));}catch{}}return found;}
function extract(body,source){
 const $=load(body),published=schemas($);
 let p=null;
 try {const next=JSON.parse($('#__NEXT_DATA__').text());for(const value of Object.values(next.props?.pageProps?.urqlState??{})){const data=typeof value.data==='string'?JSON.parse(value.data):value.data;if(data?.product){p=data.product;break;}}}catch{}
 const schema=published[0];
 if(!p&&!schema)throw Error('No published product object; not a product or extraction failed');
 const offers=Array.isArray(schema?.offers)?schema.offers:schema?.offers?[schema.offers]:[];
 const sku=schema?.sku??p?.sku??null;
 return {public_product_id:p?.id??null,public_product_uuid:p?.uuid??null,published_sku:sku,name:p?.nameWithReplacedPlaceholders??p?.name??schema?.name??null,description:text(p?.shortDescriptionWithReplacedPlaceholders??p?.shortDescription??schema?.description),source_url:source.url,final_url:source.final_url,retrieved_at:source.retrieved_at,raw_file:source.raw_file,sha256:source.sha256,brand:p?.brand?.name??(typeof schema?.brand==='string'?schema.brand:schema?.brand?.name)??null,availability_text:p?.availability?.name??null,listed_offer_prices:offers.map(o=>({price:o.price??null,currency:o.priceCurrency??null,availability:o.availability??null})),storefront_price:p?.price??null,parameters:p?.parameters??[],category_path:p?.breadcrumbs??[],variant_references:p?.mainVariant?.variants??[],published_origin_claims:text(p?.shortDescription??schema?.description).match(/[^.]*\b(?:made|manufactured|produced) in\b[^.]*/gi)??[],hts_code:null,country_of_origin:null,customs_value:null,paid_duty:null};
}
async function main(){
 const sitemapUrl='https://www.prusa3d.com/content/sitemaps/domain_1_sitemap.sellableProducts.xml';
 const map=await get(sitemapUrl);const $=load(map.body,{xmlMode:true});
 const urls=[...new Set($('loc').map((_,e)=>$(e).text().trim()).get())];
 if(!urls.length||urls.length>5000)throw Error('Sitemap empty or exceeds 5000-product bound');
 fs.writeFileSync(path.join(out,'catalogue-url-index.json'),JSON.stringify({sitemap_url:sitemapUrl,retrieved_at:map.record.retrieved_at,url_count:urls.length,urls},null,2));
 let index=0,completed=0;
 async function worker(){for(;;){const i=index++;if(i>=urls.length)return;const url=urls[i];try{const result=await get(url);products.push(extract(result.body,result.record));}catch(e){failures.push({url,error:e.message});}completed++;if(completed%100===0){fs.writeFileSync(path.join(out,'catalogue-progress.json'),JSON.stringify({requested:urls.length,completed,extracted:products.length,failures:failures.length}));console.log(`${completed}/${urls.length}: ${products.length} extracted, ${failures.length} failures`);}await sleep(120);}}
 await Promise.all([worker(),worker(),worker()]);
 products.sort((a,b)=>a.source_url.localeCompare(b.source_url));
 fs.writeFileSync(path.join(raw,'extracted-product-records.json'),JSON.stringify(products,null,2));
 const unique=new Map();for(const p of products){const key=p.public_product_uuid??p.source_url;if(!unique.has(key))unique.set(key,p);}
 const rows=[...unique.values()].map(p=>({...p,listed_offer_prices:JSON.stringify(p.listed_offer_prices),parameters:JSON.stringify(p.parameters),category_path:JSON.stringify(p.category_path),published_origin_claims:JSON.stringify(p.published_origin_claims)}));
 csv('catalogue-products.csv',rows,['public_product_id','public_product_uuid','published_sku','name','description','brand','availability_text','listed_offer_prices','parameters','category_path','published_origin_claims','hts_code','country_of_origin','customs_value','paid_duty','source_url','final_url','retrieved_at','raw_file','sha256']);
 const intake=rows.map(p=>({sku:p.published_sku||`PRUSA-PUBLIC-${p.public_product_uuid||p.public_product_id||digest(Buffer.from(p.source_url)).slice(0,12)}`,name:p.name,hts:'',origin_country:'',unit_value:'',currency:'USD',description:p.description,notes:`PUBLIC RESEARCH: identifier may be generated from website UUID, not Prusa SKU. Retail prices retained separately; no reviewed customs HTS/origin. Source ${p.source_url}`}));
 for(let i=0;i<intake.length;i+=500)csv(`catalogue-intake-${String(i/500+1).padStart(2,'0')}.csv`,intake.slice(i,i+500),['sku','name','hts','origin_country','unit_value','currency','description','notes']);
 const manifestSource='https://www.importinfo.com/prusa-research-a-s';
 const response=await get(manifestSource),m=load(response.body);
 const tables=m('table').toArray();
 const findTable=heading=>tables.find(table=>m(table).find('th').toArray().some(th=>m(th).text().trim()===heading));
 const pairs=heading=>{const table=findTable(heading);const pairs={};if(table)for(const tr of m(table).find('tr').toArray()){const label=m(tr).find('th').first().text().trim(),value=m(tr).find('td').first().text().replace(/\s+/g,' ').trim();if(label)pairs[label]=value;}return pairs;};
 const summary=pairs('Total Records'),bill=pairs('Master BOL #'),dates=pairs('Estimated Arrival Date'),shipper=pairs('Shipper Name'),consignee=pairs('Consignee Name');
 const harmonized=findTable('Harmonized Number');const codes=harmonized?m(harmonized).find('tbody tr').toArray().map(tr=>m(tr).find('td').toArray().map(td=>m(td).text().trim())).filter(r=>r.some(Boolean)):[];
 const manifest={entry_id:'',line_number:'',sku:'',hts:'',origin:'',customs_value:'',paid_duty:'',entry_date:'',master_bill_of_lading:bill['Master BOL #'],house_bill_of_lading:bill['House BOL #'],arrival_date:dates['Actual Arrival Date'],shipper:shipper['Shipper Name'],consignee:consignee['Consignee Name'],description:bill['Commodity Description'],gross_weight_reported:bill['Weight'],package_quantity_reported:bill['Quantity'],published_harmonized_fields:JSON.stringify(codes),source_url:manifestSource,retrieved_at:response.record.retrieved_at,evidence_kind:'public_ocean_manifest_not_customs_entry'};
 if(!manifest.master_bill_of_lading)throw Error('No visible public sample manifest; never substitute another company');
 csv('public-manifests.csv',[manifest],Object.keys(manifest));
 fs.writeFileSync(path.join(out,'manifest-evidence.json'),JSON.stringify({source:response.record,summary,bill,dates,shipper,consignee,published_harmonized_fields:codes,limitation:'Recent-history rows are blank registration placeholders. Only the visible sample was collected. Harmonized fields retained verbatim, not legal U.S. entry facts; zero-filled harmonized value is not asserted as customs value.'},null,2));
 const report={sitemap_url:sitemapUrl,sitemap_product_urls:urls.length,product_pages_attempted:completed,product_pages_extracted:products.length,distinct_published_product_uuids:unique.size,failed_pages:failures,full_sitemap_extraction:failures.length===0,published_sku_records:rows.filter(p=>p.published_sku).length,product_records_with_retail_offers:rows.filter(p=>JSON.parse(p.listed_offer_prices).length).length,public_manifest_rows:1,source_reported_bills_of_lading:summary['Total Records']??null,complete_customs_ledger_obtained:false,tenant_writes:0,llm_calls:0,total_download_bytes:totalBytes,sources,limitations:['Complete means current public English sellable-product sitemap, not internal ERP or every selectable configuration','Retail prices and reported origin claims are not customs entry facts','Website IDs/UUIDs are not asserted as customer SKUs','No paid/private shipment history was accessed']};
 fs.writeFileSync(path.join(out,'catalogue-source-report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({...report,sources:undefined},null,2));
}
main().catch(e=>{console.error(e);fs.writeFileSync(path.join(out,'catalogue-failure-report.json'),JSON.stringify({error:e.message,sources,failures},null,2));process.exitCode=1;});
