/** Read-only first-scan experiment. No tenant, LLM, delivery or scheduling access. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { load } from 'cheerio';
import { parseCsv } from '../lib/catalogue/csv.ts';

const root = resolve(import.meta.dirname, '..');
const folder = resolve(root, 'output/prusa-first-scan');
const raw = resolve(root, 'raw/prusa-first-scan');
const input = resolve(root, 'scripts/test-fixtures/prusa-public/first-scan-estimated.csv');
const end = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
const start = new Date(`${end}T12:00:00Z`); start.setUTCDate(start.getUTCDate()-30);
const since = start.toISOString().slice(0,10);
const products = parseCsv(await readFile(input,'utf8')).rows.map(row => ({label:row.product_label, code:row.hts_code.replace(/\D/g,''), origin:row.origin_country}));
if (products.length !== 6 || products.some(p => !/^\d{10}$/.test(p.code) || p.origin !== 'CZ' || !p.label.includes('ESTIMATE'))) throw Error('Unexpected trial input');
await mkdir(folder,{recursive:true}); await mkdir(raw,{recursive:true});
type Evidence = {name:string; url:string; success:boolean; records?:number; error?:string; hash?:string; file?:string};
const sources: Evidence[] = [];
async function capture(name:string,url:string) {
  const result:Evidence={name,url,success:false}; sources.push(result);
  try {
    const parsed = new URL(url);
    if (!['www.federalregister.gov','hts.usitc.gov','content.govdelivery.com'].includes(parsed.hostname)) throw Error('Unsupported source host');
    const response = await fetch(url,{signal:AbortSignal.timeout(25000),redirect:'error'});
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const reader=response.body!.getReader(); const chunks:Uint8Array[]=[]; let size=0;
    while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>6*1024*1024){await reader.cancel();throw Error('Source exceeded 6 MiB limit');}chunks.push(part.value);}
    const body=Buffer.concat(chunks).toString('utf8');
    result.hash=createHash('sha256').update(body).digest('hex'); result.file=resolve(raw,`${sources.indexOf(result)}-${result.hash.slice(0,12)}.txt`);
    await writeFile(result.file,body); result.success=true; return body;
  } catch(e) { result.error=e instanceof Error?e.message:String(e); return null; }
}
const uniqueCodes=[...new Set(products.map(p=>p.code))];
const schedules=[];
for (const code of uniqueCodes) {
  const dotted=code.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})$/,'$1.$2.$3.$4');
  const body=await capture(`USITC current schedule: ${dotted}`,`https://hts.usitc.gov/reststop/search?keyword=${dotted}`);
  let row=null;
  if(body) { try { const rows=JSON.parse(body); if(!Array.isArray(rows))throw Error('Schedule payload is not an array'); row=rows.find(r=>String(r.htsno).replace(/\D/g,'')===code)??null; } catch(e) { sources.at(-1)!.success=false;sources.at(-1)!.error=String(e); } }
  schedules.push({code,exactPublishedRowFound:!!row,description:row?.description??null,publishedBaseDuty:row?.general??null,totalDuty:null,changeSincePreviousScan:null});
}
const agencies=['trade-representative-office-of-united-states','u-s-customs-and-border-protection','industry-and-security-bureau','international-trade-administration','international-trade-commission','executive-office-of-the-president'];
const documents=new Map<string,any>(); const caveats=[
  'All six product classifications are estimates and Czech origin is assumed. These are not verified Prusa customs facts.',
  'First scan: there is no previous scan baseline. Recent publications are review leads, not newly detected changes.',
  'USITC rows establish published base-duty text only; additional measures and total duty were not calculated.',
  'Broad measures, product-specific exclusions and linked annexes were not evaluated; this cannot establish all applicable changes.',
  'A code/keyword mention does not establish legal applicability, a rate change, or an effective date.',
  'This bounded scan covers six Federal Register agencies and the rolling CBP CSMS feed, not every tariff source or legal annex.',
  'CBP exposes a rolling feed; older notices and notice attachments may be absent. A successful feed fetch is not complete historical coverage.'
];
for (const agency of agencies) {
  const url=new URL('https://www.federalregister.gov/api/v1/documents.json');
  url.searchParams.set('per_page','100'); url.searchParams.set('conditions[agencies][]',agency);
  url.searchParams.set('conditions[publication_date][gte]',since);url.searchParams.set('conditions[publication_date][lte]',end);
  for(const field of ['document_number','title','type','abstract','publication_date','effective_on','html_url','raw_text_url'])url.searchParams.append('fields[]',field);
  let page=1;
  while(page<=20) {
    url.searchParams.set('page',String(page));const body=await capture(`Federal Register: ${agency}, page ${page}`,url.toString()); if(!body)break;
    try {
      const json=JSON.parse(body);if(!Array.isArray(json.results)||!Number.isSafeInteger(json.total_pages)||json.total_pages<0)throw Error('Invalid Federal Register pagination');
      sources.at(-1)!.records=json.results.length;
      for(const doc of json.results)documents.set(doc.document_number,doc);
      if(page>=json.total_pages)break;
      if(page===20)caveats.push(`Federal Register ${agency} exceeded 20 pages; remaining pages were not checked.`);
      page++;
    }catch(e){sources.at(-1)!.success=false;sources.at(-1)!.error=String(e);break;}
  }
}
type Notice={title:string;url:string;publicationDate:string|null;effectiveDate:string|null;text:string;kind:string};
const notices:Notice[]=[];
const candidates=[...documents.values()].filter(d=>/tariff|dut(?:y|ies)|customs|section\s*(?:232|301)|3.?d.print|additive.manufactur|filament/i.test(`${d.title} ${d.abstract??''}`));
if(candidates.length>160)caveats.push(`${candidates.length-160} additional Federal Register title/abstract candidates were not fetched because the 160-document limit was reached.`);
let nextDetail=0;
async function detailsWorker() {
  while(nextDetail<Math.min(160,candidates.length)) {
    const d=candidates[nextDetail++];
    if(!d.raw_text_url){caveats.push(`No raw text URL for Federal Register ${d.document_number}; detail not checked.`);continue;}
    const body=await capture(`Federal Register text: ${d.document_number}`,d.raw_text_url);
    if(body)notices.push({title:d.title,url:d.html_url,publicationDate:d.publication_date,effectiveDate:d.effective_on??null,text:body,kind:d.type});
  }
}
await Promise.all([detailsWorker(),detailsWorker(),detailsWorker()]);
const cbp=await capture('CBP CSMS rolling feed','https://content.govdelivery.com/accounts/USDHSCBP/widgets/USDHSCBP_WIDGET_2.rss');
if(cbp) {
  const $=load(cbp,{xmlMode:true});const items=$('item'); sources.at(-1)!.records=items.length;
  if(!items.length){sources.at(-1)!.success=false;sources.at(-1)!.error='No RSS items; feed structure not verified.';}
  items.each((_,item)=>{const date=new Date($(item).find('pubDate').text()); if(!Number.isFinite(date.valueOf())){caveats.push('CBP item has an invalid date and was not evaluated.');return;}const day=date.toISOString().slice(0,10);if(day<since||day>end)return;
    notices.push({title:$(item).find('title').text(),url:$(item).find('link').text(),publicationDate:day,effectiveDate:null,text:load($(item).find('description').text()).text(),kind:'CBP operational bulletin'});
  });
}
const leads=[];
notices.sort((a,b)=>String(b.publicationDate).localeCompare(String(a.publicationDate))||a.url.localeCompare(b.url));
for(const notice of notices) {
  const matched=new Set<string>(); const reasons=[];
  for(const code of uniqueCodes) {
    for(const length of [10,8,6,4]) {
      const prefix=code.slice(0,length);const pattern=prefix.split('').join('[. \\t]?');
      if(new RegExp(`(?<![\\d.])${pattern}(?![\\d.])`).test(notice.text)) {
        products.filter(p=>p.code.startsWith(prefix)).forEach(p=>matched.add(p.label));reasons.push(`Published text mentions HTS ${prefix}; scope still needs review.`);break;
      }
    }
  }
  if(/3.?d.print|additive.manufactur|plastic.filament|printer.filament/i.test(notice.text)){reasons.push('Product-family words appear; classification and legal scope need review.');products.forEach(p=>matched.add(p.label));}
  if(reasons.length)leads.push({title:notice.title,url:notice.url,publicationDate:notice.publicationDate,publishedEffectiveDate:notice.effectiveDate,kind:notice.kind,status:'Needs legal scope review',potentialProductLabels:[...matched],reasons,nextAction:'Read the controlling notice and annex with your broker. Confirm HTS, origin, effective date and exclusions before acting.'});
}
const report={checkedAt:new Date().toISOString(),window:{since,through:end},status:'Partial public-source scan; review leads only',productCount:products.length,products,schedules,federalRegisterDocumentsListed:documents.size,federalRegisterDetailsSelected:candidates.length,noticesExamined:notices.length,confirmedProductChanges:null,reviewLeads:leads,sources,caveats,databaseWrites:0,llmCalls:0,customerProfileUsed:false};
await writeFile(resolve(folder,'report.json'),JSON.stringify(report,null,2));
const clean=(s:unknown)=>String(s??'Not established').replaceAll('|','\\|').replaceAll('\n',' ');
const lines=['# Prusa first scan','',`Checked ${report.checkedAt}. Publication window: ${since}–${end}.`,'','**Partial scan — review leads only.** No confirmed product change or complete-duty result is claimed.','',`Six pseudonymous products; ${documents.size} Federal Register listings; ${notices.length} notice texts examined; ${sources.filter(s=>!s.success).length} failed source requests.`,'','## Products','', '| Product | Estimated HTS | Assumed origin |','|---|---|---|',...products.map(p=>`| ${p.label} | ${p.code} | ${p.origin} |`),'','## Review leads',''];
if(!leads.length)lines.push('No direct code or product-family matches were identified in the examined text. This is not an all-clear: broader measures, attachments and unexamined sources still require review.');
for(const lead of leads)lines.push(`### ${clean(lead.title)}`,'',`[Government source](${lead.url}) · published ${lead.publicationDate} · effective date: ${clean(lead.publishedEffectiveDate)}`,'',`**Potential products:** ${lead.potentialProductLabels.join(', ')}`,'',...lead.reasons.map(r=>`- ${r}`),'',lead.nextAction,'');
lines.push('','## Coverage and next steps','',...caveats.map(c=>`- ${c}`),'','## Source requests','', '| Source | Status | Evidence |','|---|---|---|',...sources.map(s=>`| ${clean(s.name)} | ${s.success?'Fetched':'Failed: '+clean(s.error)} | [Source](${s.url}) |`),'','No account, company profile, private supplier/pricing data, paid model calls, database writes, notifications or schedules were used. Re-run with `node --import tsx scripts/scan-public-prusa-first.mts`.');
await writeFile(resolve(folder,'report.md'),lines.join('\n')+'\n');
console.log(JSON.stringify({productCount:products.length,documentsListed:documents.size,noticesExamined:notices.length,reviewLeads:leads.length,failedRequests:sources.filter(s=>!s.success).length,confirmedProductChanges:null,report:resolve(folder,'report.md')}));
