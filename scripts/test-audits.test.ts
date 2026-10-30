import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { auditTable,suggestMapping,parseAudit,validateMapping,moneyText } from "../app/api/audits/input";
import { defaultOptions,bundleSchema,factDecisionSchema,type RuleBundle,type FactDecision } from "../app/api/audits/model";
import { evaluateAuditEntry,summarizeAudit,validateBundle } from "../app/api/audits/engine";
import { GET as testSample, POST as testRun } from "../app/audit-test/run/route";
import { localAuditTestAvailable, runAuditFixture } from "../app/audit-test/fixture";
import { computeExactDuty } from "../lib/tariff/duty-expression";
import {exportAudit} from "../app/api/audits/store";
import {parseCsv} from "../lib/catalogue/csv";
const path="scripts/test-fixtures/historical-audits/";
const csv=readFileSync(path+"entries.csv","utf8");
const bundle=JSON.parse(readFileSync(path+"rules.json","utf8")) as RuleBundle;
const decisions=JSON.parse(readFileSync(path+"decisions.json","utf8")) as FactDecision[];
const expected=JSON.parse(readFileSync(path+"expected.json","utf8"));
const options={...defaultOptions,currencyUsd:true,dutiesOnly:true,ordinaryConsumption:true};
const mapping=suggestMapping(auditTable(csv).headers);
const entries=parseAudit(csv,mapping,options);
test("100 fictional dated caps match an independent decimal oracle without human approval or network calls",()=>{
  const capCsv=readFileSync(path+"exact-cap-entries.csv","utf8");
  const capBundle=JSON.parse(readFileSync(path+"exact-cap-rules.json","utf8")) as RuleBundle;
  const oracle=JSON.parse(readFileSync(path+"exact-cap-expected.json","utf8"));
  const lines=parseAudit(capCsv,suggestMapping(auditTable(capCsv).headers),options);
  assert.equal(capBundle.status,"draft");assert.equal(capBundle.approved_by,null);
  assert.throws(()=>evaluateAuditEntry(lines[0],[capBundle],"synthetic-product"),/Synthetic/);
  const original=globalThis.fetch;globalThis.fetch=()=>{throw Error("No network allowed");};
  try {
    const results=lines.map((entry,i)=>{
      assert.deepEqual(entry.errors,[]);
      const result=evaluateAuditEntry(entry,[capBundle],"synthetic-product",[],true);
      assert.equal(result.expected,oracle.entries[i].expected,entry.date);
      assert.equal(result.difference,oracle.entries[i].difference,entry.date);
      assert.equal(result.components[0].rate,`${i+1}%`);
      assert.equal(entry.raw.total_duties_paid,oracle.entries[i].paid);
      return result;
    });
    assert.deepEqual(summarizeAudit(results),oracle.summary);
    // Formatter-only fixture: this flag is no worker/database attestation.
    const report=parseCsv(exportAudit({batch:{id:"SYNTHETIC-EXACT-CAPS"},rows:lines.map((entry,i)=>({entry,result:results[i]})),decisions:[],verified:true,resultRevision:0}),undefined,true);
    assert.equal(report.rows.length,100);
    report.rows.forEach((r,i)=>{
      assert.equal(r.expected_duty_usd,oracle.entries[i].expected);
      assert.equal(r.paid_minus_expected_usd,oracle.entries[i].difference);
      assert.equal(r.paid_duty_usd,oracle.entries[i].paid);
      assert.equal(r.declared_hts,"8501314000");
      assert.match(r.original_input_json,/SYN-CAP-/);
      assert.match(r.components_and_citations,/synthetic.invalid/);
    });
    const missingDate={...lines[99],date:"2024-04-10"};
    assert.equal(evaluateAuditEntry(missingDate,[capBundle],"synthetic-product",[],true).expected,"2001.00");
    assert.equal(evaluateAuditEntry({...missingDate,date:"2025-01-01"},[capBundle],"synthetic-product",[],true).expected,null);
    const compound=structuredClone(capBundle);compound.definition.measures[0].rate="1 cent/kg + 200%";
    const unresolved=evaluateAuditEntry(lines[28],[compound],"synthetic-product",[],true);
    assert.equal(unresolved.expected,null);assert.ok(unresolved.findings.some(f=>f.type==="stacking_review"));
  } finally {globalThis.fetch=original;}
});
test("120 fictional entries match independently specified line results and gross totals",()=>{
  const results=entries.map(e=>evaluateAuditEntry(e,[bundle],"synthetic-product",decisions,true));
  assert.equal(results.length,120);
  for(const [i,r] of results.entries()){assert.equal(r.expected,expected.entries[i].expected,`row ${i+1}`);assert.equal(r.difference,expected.entries[i].difference,`row ${i+1}`);assert.deepEqual(r.findings.map(f=>f.type).sort(),expected.entries[i].findingTypes.sort(),`row ${i+1}`);}
  assert.deepEqual(summarizeAudit(results),expected.summary);
});

test("a retained numeric cap uses its selected instruction without replacing the approved bundle",()=>{
 const b=JSON.parse(readFileSync(path+"exact-cap-rules.json","utf8")) as RuleBundle;
 b.definition.stacking=[];
 const reference:import("../app/api/tariff/references/store").AuditReference={release:null,rate:null,chapter99:[],chapter99Rates:[],sources:[],legacyMeasures:[],gaps:[],stackingRules:[{id:"SYN-STORED-CAP",targetMeasure:"SYN-CAP-BASE",action:"cap_at",capRatePercent:0.29,conditions:{},priority:100,citation:"SYNTHETIC ONLY",ruleText:"Fictional retained stacking instruction",effectiveDate:"2024-01-01",expiresDate:"2025-01-01",precedenceOver:null,precedenceReason:null}]};
 const row={...entries[0],origin:"JP",value:"1000.50",chapter99:[],exclusion:""};
 const result=evaluateAuditEntry(row,[b],"synthetic-product",[],true,undefined,reference);
 assert.equal(result.expected,"290.15");assert.match(result.components[0].explanation,/SYNTHETIC ONLY/);
 reference.stackingRules[0].capRatePercent=null;
 assert.equal(evaluateAuditEntry(row,[b],"synthetic-product",[],true,undefined,reference).expected,null);
});
test("historical calculation performs no network or model calls",()=>{
  const original=globalThis.fetch;globalThis.fetch=()=>{throw Error("Network forbidden in historical calculation");};
  try{assert.equal(evaluateAuditEntry(entries[0],[bundle],"synthetic-product",decisions,true).expected,"300.00");}finally{globalThis.fetch=original;}
});
test("synthetic rules and unapproved/auto-approved bundles fail closed in real workspaces",()=>{
  assert.throws(()=>evaluateAuditEntry(entries[0],[bundle],"p",decisions),/Synthetic/);
  const real={...bundle,definition:{...bundle.definition,synthetic:false}};
  assert.throws(()=>validateBundle({...real,status:"draft"},true),/human approval/);
  assert.throws(()=>validateBundle({...real,approved_by:null},true),/human approval/);
  assert.throws(()=>validateBundle({...real,approved_at:null},true),/human approval/);
  const draft={...bundle,status:"draft" as const,approved_by:null,approved_at:null};
  assert.throws(()=>validateBundle(draft),/Synthetic/);
  assert.equal(validateBundle(draft,true).synthetic,true);
  assert.equal(bundleSchema.safeParse({...bundle.definition,unknown:"field"}).success,false);
});
test("origin relocation is a review issue; only dated evidence-backed decisions change calculations",()=>{
  const row=entries[40];const initial=evaluateAuditEntry(row,[bundle],"p",decisions,true);assert.equal(initial.expected,null);assert.ok(initial.findings.some(f=>f.type==="origin_mismatch"));
  const correction:FactDecision={row:row.row,kind:"confirm_facts",note:"Synthetic legal origin decision, valid for these lots.",evidence:["SYN-DOC-02"],validFrom:"2024-05-01",validBefore:"2024-06-01",origin:"VN",facts:{origin_verified:true},id:"SYN-CORRECTION"};
  const corrected=evaluateAuditEntry(row,[bundle],"p",[...decisions,correction],true);assert.equal(corrected.expected,"50.00");assert.equal(corrected.difference,"250.00");assert.equal(row.origin,"CN");
  assert.equal(evaluateAuditEntry(row,[bundle],"p",[...decisions,{...correction,evidence:[]}],true).expected,null);
  assert.equal(evaluateAuditEntry(row,[bundle],"p",[...decisions,{...correction,validFrom:"2024-06-01"}],true).expected,null);
});
test("leading zeros, original strings and declared facts survive import",()=>{
  assert.equal(entries[110].hts,"0101210010");assert.equal(entries[0].line,"001");assert.equal(entries[0].raw.entry_number,"SYN-001");
  assert.equal(entries[60].hts,"");assert.equal(entries[65].hts,"85013140");assert.ok(entries[65].errors.length);
});
test("missing paid duty, currency and required confirmations cannot become zero or dollars",()=>{
  for(const s of ["EUR 100","€100","CAD 100","-1","1e6","1,23.00",".05"] )assert.equal(moneyText(s),null,s);
  assert.equal(moneyText("USD 1,000.25"),"1000.25");assert.equal(moneyText("0"),"0.00");assert.equal(moneyText(""),null);
  const missing=parseAudit(csv,mapping,defaultOptions)[0];assert.ok(missing.errors.some(e=>e.includes("duties only")));assert.ok(missing.errors.some(e=>e.includes("ordinary")));
  const row={...entries[0],errors:[],paid:null};assert.equal(evaluateAuditEntry(row,[bundle],"p",decisions,true).expected,null);
});
test("component totals require explicit completeness and reject disagreement",()=>{
  const text="entry_number,line_number,entry_date,sku,hts,origin,customs_value,base_duty_paid,additional_duties_paid,total_duties_paid\nA,1,2024-05-15,P,8501314000,CN,1000,50,250,";
  const map=suggestMapping(auditTable(text).headers);assert.equal(parseAudit(text,map,options)[0].paid,null);
  assert.equal(parseAudit(text,map,{...options,componentsComplete:true})[0].paid,"300.00");
  assert.ok(parseAudit(text+"299",map,options)[0].errors.some(e=>e.includes("do not equal")));
});
test("ambiguous dates require the selected locale and impossible dates stay invalid",()=>{
  const text=csv.replace("2024-05-15","06/05/2024");assert.ok(parseAudit(text,mapping,options)[0].errors.some(e=>e.includes("date")));
  assert.equal(parseAudit(text,mapping,{...options,dateFormat:"mdy"})[0].date,"2024-06-05");assert.equal(parseAudit(text,mapping,{...options,dateFormat:"dmy"})[0].date,"2024-05-06");
  assert.ok(parseAudit(csv.replace("2024-05-15","2024-02-30"),mapping,options)[0].errors.length);
});
test("duplicate identity is not aggregated and mappings cannot invent or reuse columns",()=>{
  const lines=csv.trim().split(/\r?\n/);const dup=lines[0]+"\n"+lines[1]+"\n"+lines[1];assert.ok(parseAudit(dup,mapping,options).every(r=>r.errors.some(e=>e.includes("Duplicate"))));
  assert.throws(()=>validateMapping(auditTable(csv).headers,{...mapping,hts:"not-in-upload"}));assert.throws(()=>validateMapping(auditTable(csv).headers,{...mapping,origin:mapping.hts}));
  assert.throws(()=>auditTable("a,a\n1,2"));assert.throws(()=>auditTable("a,b\n1"));
});
test("exact historical arithmetic covers tiny, compound, specific and large decimal amounts",()=>{
  assert.equal(computeExactDuty("2.5 cents/kg + 5%",{value:"19.90",quantity:"10",unit:"kg"}),"1.25");
  assert.equal(computeExactDuty("$0.005/kg",{value:"1000.00",quantity:"10",unit:"kg"}),"0.05");
  assert.equal(computeExactDuty("5%",{value:"0.10"}),"0.01");assert.equal(computeExactDuty("5%",{value:"999999999999.99"}),"50000000000.00");
  assert.equal(computeExactDuty("2 cents/kg + 5%",{value:"1000.00",quantity:"2",unit:"lb"}),null);assert.equal(computeExactDuty("5% or 2 cents/kg",{value:"1000.00",quantity:"2",unit:"kg"}),null);
  assert.equal(computeExactDuty("Free (unverified qualification)",{value:"1000.00"}),null);
});
test("a current catalogue origin is a review lead, never historical proof",()=>{
  const r=evaluateAuditEntry(entries[0],[bundle],"p",decisions,true,"VN");assert.equal(r.expected,null);assert.ok(r.findings.some(f=>f.type==="catalogue_origin_mismatch"));
  assert.equal(evaluateAuditEntry(entries[0],[bundle],"p",[...decisions,{row:1,kind:"confirm_facts",note:"Synthetic dated review confirms the original declaration",evidence:["SYN-DOC"],validFrom:"2024-01-01",validBefore:"2025-01-01",facts:{origin_verified:true}}],true,"VN").expected,"300.00");
});
test("origin/classification corrections require explicit reviewed decisions",()=>{
  const input={row:1,kind:"confirm_facts",note:"Synthetic supporting decision",evidence:["SYN-DOC"],validFrom:"2024-01-01",validBefore:"2025-01-01"};
  assert.equal(factDecisionSchema.safeParse({...input,origin:"VN"}).success,false);assert.equal(factDecisionSchema.safeParse({...input,hts:"8501324000"}).success,false);
  assert.equal(factDecisionSchema.safeParse({...input,origin:"VN",facts:{origin_verified:true}}).success,true);
});
test("component allocations can be flagged without claiming a legal cause",()=>{
  const row={...entries[30],basePaid:"50.00",additionalPaid:"262.50"};const r=evaluateAuditEntry(row,[bundle],"p",decisions,true);assert.equal(r.expected,"300.00");assert.ok(r.findings.some(f=>f.type==="paid_component_mismatch"));
});
test("an inapplicable or unresolved conditional base rate never becomes a zero-duty assessment",()=>{
  const conditional=structuredClone(bundle);conditional.definition.measures[0].conditions={exclusion_qualified:true};
  const r=evaluateAuditEntry(entries[0],[conditional],"p",decisions,true);assert.equal(r.expected,null);assert.ok(r.findings.some(f=>f.type==="base_coverage"));
  conditional.definition.measures[0].conditions={__unknown_fact__:false};assert.equal(evaluateAuditEntry(entries[0],[conditional],"p",decisions,true).expected,null);
});
test("unknown dates, conflicting snapshots, missing source references and unmatched products withhold totals",()=>{
  assert.equal(evaluateAuditEntry(entries[0],[],"p",decisions,true).expected,null);
  assert.equal(evaluateAuditEntry(entries[0],[bundle,{...bundle,id:"another"}],"p",decisions,true).expected,null);
  assert.equal(evaluateAuditEntry(entries[0],[bundle],null,decisions,true).expected,null);
  const bad=structuredClone(bundle);bad.definition.measures[0].sourceIds=["missing"];assert.throws(()=>validateBundle(bad,true),/source/);
});


test("local workflow test skips approval only for fictional drafts and matches all independent results",()=>{
  const result=runAuditFixture({action:"run",csv,filename:"SYNTHETIC.csv",mapping,options});
  assert(result.detail);assert.equal(result.detail.mode,"synthetic_test");
  assert.deepEqual(result.detail.summary,expected.summary);
  for(const [i,{result:r}] of result.detail.rows.entries()){
    assert.equal(r.expected,expected.entries[i].expected,`test UI row ${i+1}`);
    assert.equal(r.difference,expected.entries[i].difference);
    assert.deepEqual(r.findings.map(f=>f.type).sort(),[...expected.entries[i].findingTypes].sort());
  }
  assert(result.csv?.includes("SYNTHETIC TEST ONLY"));
  assert(result.csv?.includes('"-50.00"'));assert(!result.csv?.includes('"\'-50.00"'));
});
test("local test is unavailable in production, hosted development and missing environments",()=>{
  assert.equal(localAuditTestAvailable({NODE_ENV:"development"}),true);
  for(const env of [{NODE_ENV:"production"},{NODE_ENV:"test"},{NODE_ENV:"development",VERCEL:"1"},{}])assert.equal(localAuditTestAvailable(env),false);
});
test("test harness preserves validation, explicit missing facts and approval boundaries",()=>{
  const input={action:"run",csv,filename:"SYNTHETIC.csv",mapping,options};
  assert.throws(()=>runAuditFixture({...input,rules:[bundle]}));
  const d=runAuditFixture({...input,options:defaultOptions}).detail!;assert.equal(d.summary.calculated,0);
  const changed=csv.replace("SYNTHETIC test cohort 1","Changed row is not the supplied fixture");
  const r=runAuditFixture({...input,csv:changed}).detail!.rows[0].result;
  assert.equal(r.expected,null);assert.ok(r.findings.some(f=>f.type==="stacking_review"));
});
test("test workflow can review an origin discrepancy and recalculate without changing its original",()=>{
  const review={row:41,kind:"confirm_facts",note:"Fictional reviewed origin decision for workflow testing",evidence:["SYN-ORIGIN-DOC"],validFrom:"2024-01-01",validBefore:"2025-01-01",origin:"VN",facts:{origin_verified:true}};
  const result=runAuditFixture({action:"run",csv,filename:"SYNTHETIC.csv",mapping,options,reviews:[review]}).detail!;
  assert.equal(result.batch.revision,1);assert.equal(result.rows[40].entry.origin,"CN");assert.equal(result.rows[40].result.appliedOrigin,"VN");assert.equal(result.rows[40].result.expected,"50.00");assert.equal(result.rows[40].result.difference,"250.00");
  assert.throws(()=>runAuditFixture({action:"run",csv,filename:"SYNTHETIC.csv",mapping,options,reviews:[{...review,evidence:[]}]}),/evidence/);
  assert.throws(()=>runAuditFixture({action:"run",csv,filename:"SYNTHETIC.csv",mapping,options,reviews:[{row:41,kind:"resolved",note:"Pretend this unresolved result is complete"}]}),/unresolved/);
});


test("actual test endpoint rejects hosted/production calls and bounds local test requests",async()=>{
  const before={NODE_ENV:process.env.NODE_ENV,VERCEL:process.env.VERCEL};
  try{
    Object.assign(process.env,{NODE_ENV:"production"});delete process.env.VERCEL;
    assert.equal((await testSample()).status,404);
    assert.equal((await testRun(new Request("http://localhost/audit-test/run",{method:"POST",body:"{}"}))).status,404);
    Object.assign(process.env,{NODE_ENV:"development",VERCEL:"1"});assert.equal((await testSample()).status,404);
    delete process.env.VERCEL;
    assert.equal((await testSample()).status,200);
    assert.equal((await testRun(new Request("http://localhost/audit-test/run",{method:"POST",headers:{origin:"https://unrelated.test"},body:"{}"}))).status,403);
    assert.equal((await testRun(new Request("http://localhost/audit-test/run",{method:"POST",headers:{"content-length":"5000000"},body:"{}"}))).status,413);
    const response=await testRun(new Request("http://localhost/audit-test/run",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"run",csv,filename:"SYNTHETIC.csv",mapping,options})}));
    assert.equal(response.status,200);assert.equal(response.headers.get("x-cante-result-mode"),"synthetic-test");assert.deepEqual((await response.json()).detail.summary,expected.summary);
  }finally{
    for(const key of ["NODE_ENV","VERCEL"] as const){if(before[key]===undefined)delete process.env[key];else Object.assign(process.env,{[key]:before[key]});}
  }
});
