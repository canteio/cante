import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {normalizeReleases,archivePage,archiveIndex,referencePackage,officialReferenceUrl,projectHistoricalRates} from "../app/api/tariff/references/ingestion";
import {candidateRelease,decodeReference,referenceForEntry,validateReleaseSnapshot,type ReferenceSource,type AuditReference} from "../app/api/tariff/references/store";
import {prepareReferenceDraft} from "../app/api/audits/preparation";
import {evaluateAuditEntry} from "../app/api/audits/engine";
import {auditTable,suggestMapping,parseAudit} from "../app/api/audits/input";
import {defaultOptions,type RuleBundle} from "../app/api/audits/model";
const rawRelease=(name:string,start="01/01/2024",end="06/01/2024")=>({name,status:"archive",description:"Historical edition",date:"12/29/2023",releaseStartDate:start,releaseEndDate:end});
const releases=normalizeReleases([rawRelease("2024HTSRev1"),rawRelease("2024HTSRev2","06/01/2024","")]);
const source=(id:string,kind:string):ReferenceSource=>({id,kind,release_name:releases[0].name,url:"https://www.usitc.gov/retained",title:"Historical original",original_sha256:"a".repeat(64),captured_at:"2026-10-22T00:00:00Z",metadata:{},rate_count:1});
const rate={source_id:"schedule",hts:"8501314000",description:"Test",general:"4%",special:"Free (A)",column2:"35%",additional_duties:"",units:["No."],footnotes:[{value:"See 9903.88.02 and 9903.88.67"}]};
const reference=referenceForEntry({date:"2024-05-15",hts:rate.hts},releases,[source("schedule","hts_json"),source("notes","chapter99_pdf")],[rate,{...rate,hts:"99038802",general:"25%"},{...rate,hts:"99038867",general:"Free"}],new Map());
test("publisher identifiers retain historical spelling and exclude unrecognized preliminary files",()=>{
 assert.deepEqual(normalizeReleases([rawRelease("2023HTSARev4a"),rawRelease("2018BasicEdition"),rawRelease("2024HTSPrelimRev1")]).map(r=>r.name),["2023HTSARev4a","2018BasicEdition"]);
 assert.throws(()=>normalizeReleases([rawRelease("2024HTSRev1","02/30/2024")]));
 assert.throws(()=>normalizeReleases([rawRelease("2024HTSRev1"),rawRelease("2024HTSRev1")]));
});
test("edition availability is bounded, unambiguous and distinct from publication",()=>{
 assert.equal(candidateRelease(releases,"2024-05-31")?.name,"2024HTSRev1");assert.equal(candidateRelease(releases,"2024-06-01")?.name,"2024HTSRev2");
 assert.equal(candidateRelease(releases,"2023-12-29"),null);assert.equal(candidateRelease(releases,"2024-02-30"),null);assert.equal(candidateRelease([...releases,releases[0]],"2024-05-01"),null);
 assert.throws(()=>validateReleaseSnapshot([{...releases[0],published_on:"2024-02-30"}]));
});
test('first-day April metal amendment pins only its note, retaining the entry-date commodity rate',()=>{
 const dates=[{name:'2026HTSRev4',description:'SYNTHETIC old edition',published_on:'2026-02-25',available_from:'2026-02-25',available_until:'2026-04-08'},{name:'2026HTSRev5',description:'SYNTHETIC first consolidation',published_on:'2026-04-08',available_from:'2026-04-08',available_until:'2026-04-23'}];
 const old={...source('OLD-RATE','hts_json'),release_name:dates[0].name},amendment={...source('AMENDMENT-NOTE','chapter99_pdf'),release_name:dates[1].name,metadata:{revisionVerified:true}},future={...source('LATER-RATE','hts_json'),release_name:dates[1].name};
 const retained=[old,amendment,future],rates=[{...rate,source_id:old.id,footnotes:[]},{...rate,source_id:future.id,general:'99%',footnotes:[]}];
 for(const date of ['2026-04-06','2026-04-07']){const ref=referenceForEntry({date,hts:rate.hts},dates,retained,rates,new Map());assert.equal(ref.rate?.source_id,old.id);assert.equal(ref.rate?.general,'4%');assert(ref.sources.some(s=>s.id===amendment.id));assert(!ref.sources.some(s=>s.id===future.id));}
 const preceding=referenceForEntry({date:'2026-04-05',hts:rate.hts},dates,retained,rates,new Map());assert(!preceding.sources.some(s=>s.id===amendment.id));
 const unverified=referenceForEntry({date:'2026-04-06',hts:rate.hts},dates,[old,{...amendment,metadata:{revisionVerified:false}},future],rates,new Map());assert(!unverified.sources.some(s=>s.id===amendment.id));
});
test("edition discovery follows explicit official links and rejects ambiguous pages",()=>{
 assert.equal(archivePage('<a href="https://hts.usitc.gov/reststop/file?release=2023HTSARev4a">Edition</a><a href="/published_json.json">JSON</a>',"https://www.usitc.gov/edition").release,"2023HTSARev4a");
 assert.throws(()=>archivePage('<a href="/guessed.json">X</a>',"https://www.usitc.gov/edition"));
 assert.throws(()=>officialReferenceUrl("https://www.usitc.gov.example.org/file"));assert.throws(()=>officialReferenceUrl("https://user@www.usitc.gov/file"));
});
test('bulk discovery keeps editions separate, follows bounded publisher pagination and reports PDF-only archives',()=>{
 const page='<div><h3>2024 revision 3</h3><div class="views-field-nothing"><a href="https://hts.usitc.gov/download?release=2024HTSRev3">HTML</a><a href="/2024_json.json">JSON</a></div><a href="https://www.federalregister.gov/d/2024-10000">Amendment</a></div><div><h3>1990 original</h3><div class="views-field-nothing"><a href="/1990.pdf">PDF</a></div></div><a href="?page=1">Next</a><a href="https://example.com/?page=2">Other</a>';
 const result=archiveIndex(page,'https://www.usitc.gov/harmonized_tariff_information/hts/archive/list');
 assert.equal(result.editions.length,1);assert.equal(result.editions[0].release,'2024HTSRev3');assert.equal(result.editions[0].json,'https://www.usitc.gov/2024_json.json');assert.deepEqual(result.editions[0].notices,['https://www.federalregister.gov/d/2024-10000']);assert.equal(result.unavailable[0].title,'1990 original');assert.equal(result.pages.length,1);
 assert.throws(()=>archiveIndex('<p>Access denied</p>','https://www.usitc.gov/harmonized_tariff_information/hts/archive/list'));
});
test("lossless references verify both stored and original bytes and decompression budget",()=>{
 const bytes=Buffer.from("retained government bytes ".repeat(10000));const pack=referencePackage({kind:"hts_json",url:"https://www.usitc.gov/file",title:"Test",bytes});
 const retained={...source("one","hts_json"),...pack} as ReferenceSource;
 assert.deepEqual(decodeReference(retained),bytes);
 assert.throws(()=>decodeReference({...retained,body:Buffer.from("changed").toString("base64")}));
 assert.throws(()=>decodeReference({...retained,original_sha256:"b".repeat(64)}));assert.throws(()=>decodeReference({...retained,original_bytes:25000001}));
});
test("real reference evidence never becomes an approved historical duty total",()=>{
 const csv=readFileSync("scripts/test-fixtures/historical-audits/entries.csv","utf8"),entries=parseAudit(csv,suggestMapping(auditTable(csv).headers),{...defaultOptions,currencyUsd:true,dutiesOnly:true,ordinaryConsumption:true});
 const result=evaluateAuditEntry(entries[0],[],"product",[],false,undefined,reference);
 assert.equal(result.expected,null);assert.ok(result.findings.some(f=>f.type==="historical_coverage"));assert.equal(result.reference?.rate?.general,"4%");
});
test("draft preparation preserves published rate, explicit interval and conditional headings",()=>{
 const draft=prepareReferenceDraft(reference,{hts:rate.hts,origin:"CN",from:"2024-05-15",before:"2024-05-16",column:"general"});
 assert.equal(draft.definition.measures[0].rate,"4%");assert.equal(draft.definition.measures[0].from,"2024-05-15");assert.ok(draft.definition.measures.some(m=>m.id==="9903.88.02"&&m.rate==="25%"));
 assert.ok(draft.definition.stacking.some(s=>s.conditions.exclusion_qualified===false));assert.ok(draft.definition.measures.some(m=>m.conditions.__historical_scope_review__===true));
 assert.ok(draft.sources.every(s=>s.referenceId));assert.throws(()=>prepareReferenceDraft(reference,{hts:rate.hts,origin:"CN",from:"2024-02-30",before:"2024-06-01",column:"general"}));
 const vn=prepareReferenceDraft(reference,{hts:rate.hts,origin:"VN",from:"2024-05-15",before:"2024-05-16",column:"general"});assert.ok(!vn.definition.measures.some(m=>m.type==="section301"));
});
test("a claimed exclusion cannot silently remove Section 301 in a prepared draft",()=>{
 const only301:AuditReference={...reference,chapter99:["9903.88.02"],chapter99Rates:reference.chapter99Rates.filter(r=>r.hts==="99038802")};
 const draft=prepareReferenceDraft(only301,{hts:rate.hts,origin:"CN",from:"2024-05-15",before:"2024-05-16",column:"general"});
 const fixture=JSON.parse(readFileSync("scripts/test-fixtures/historical-audits/rules.json","utf8")) as RuleBundle;
 const bundle:RuleBundle={...fixture,definition:{...draft.definition,synthetic:true},sources:draft.sources.map(s=>({id:s.id,url:"https://www.usitc.gov/test",title:"SYNTHETIC",body:"",encoding:"utf8" as const,sha256:"a".repeat(64),capturedAt:"2026-10-22T00:00:00Z"}))};
 const csv=readFileSync("scripts/test-fixtures/historical-audits/entries.csv","utf8"),entry=parseAudit(csv,suggestMapping(auditTable(csv).headers),{...defaultOptions,currencyUsd:true,dutiesOnly:true,ordinaryConsumption:true})[0];
 const decision={row:entry.row,kind:"confirm_facts" as const,note:"Synthetic supported qualification decision",evidence:["SYNTHETIC-DOC"],validFrom:"2024-05-15",validBefore:"2024-05-16",facts:{standard_commercial:true,origin_verified:true,classification_verified:true,adcvd_clear:true,other_232_clear:true,exclusion_qualified:true}};
 assert.equal(evaluateAuditEntry(entry,[bundle],"p",[decision],true).expected,null);
 assert.equal(evaluateAuditEntry(entry,[bundle],"p",[{...decision,facts:{...decision.facts,exclusion_qualified:false}}],true).expected,"290.00");
});

test("older full-edition projections preserve leading zeros, inheritance, units and citations",()=>{
 const rows:Record<string,unknown>[]=[{htsno:"0101.00.00",indent:0,description:"Parent",general:"4%",special:"",other:"35%",units:"",footnotes:[{value:"See 9903.88.02"}]}];
 for(let chapter=1;chapter<=99;chapter++)if(chapter!==77){
  for(let i=1;i<=(chapter===1?9903:1);i++){
   const code=String(chapter).padStart(2,"0")+(1000000+i).toString().padStart(8,"0");
   rows.push({htsno:`${code.slice(0,4)}.${code.slice(4,6)}.${code.slice(6,8)}.${code.slice(8)}`,indent:chapter===1?1:0,description:"Statistical item",general:chapter===1?"":"Free",special:"",other:"",units:i===1?["No."]:"",footnotes:[]});
  }
 }
 const projected=projectHistoricalRates(rows);assert.equal(projected.length,10000);assert.equal(projected[0].hts,"0101000001");assert.equal(projected[0].general,"4%");assert.deepEqual(projected[0].units,["No."]);assert.ok(projected[0].footnotes.length);
 assert.throws(()=>projectHistoricalRates(rows.filter(r=>!(r.htsno as string).startsWith("02"))),/omits a chapter/);
 assert.throws(()=>projectHistoricalRates(rows.map((r,i)=>i===1?{...r,units:"unknown string unit"}:r)));
});

test('observed official preliminary publications fill their own registry intervals without advancing next-year rates',()=>{
 const original=JSON.parse(readFileSync('scripts/test-fixtures/historical-audits/published-preliminary-releases.json','utf8')),r=normalizeReleases(original.releases);assert.equal(r.length,5);assert.equal(r.find(x=>x.name==='2021HTSAPreliminary')?.available_from,'2021-01-01');assert.equal(candidateRelease(r,'2021-01-15')?.name,'2021HTSAPrelimRev2');assert.equal(candidateRelease(r,'2022-01-09')?.name,'2022HTSAPrelimC');assert.equal(candidateRelease(r,'2020-12-31'),null,'A next-year preliminary publication cannot establish the preceding year’s rates');assert.equal(candidateRelease(r,'2022-01-03'),null,'Missing published coverage remains explicit');assert.equal(candidateRelease(r,'2022-01-26'),null,'The preliminary interval ends at the next published edition');
});
