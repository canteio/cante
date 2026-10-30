/** Fictional declarations and source text: functionality tests, not legal proof. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {chapter99NonApplicability,chapter99Code,declaredChapter99,proveHistoricalChapter99,type HistoricalExclusion} from '../app/api/tariff/references/chapter99-contract';
import {evaluateAuditEntry} from '../app/api/audits/engine';
import {factDecisionSchema,type AuditEntry,type FactDecision} from '../app/api/audits/model';
import type {AuditReference} from '../app/api/tariff/references/store';

const item:HistoricalExclusion={heading:'9903.88.67',target:'9903.88.02',hts:'8501314000',scope:'20(ttt)(ii)(1)',description:'SYNTHETIC motor with specified dimensions (described in statistical reporting number 8501.31.4000)',from:'2024-01-01',before:'2024-06-01',boundaryDays:['2024-01-01','2024-05-31'],sourceIds:['notes','extension']};
const entry:AuditEntry={row:1,entry:'SYNTHETIC-CHAPTER99',line:'001',date:'2024-02-15',sku:'SYNTHETIC-MOTOR',description:'SYNTHETIC scope test only',hts:item.hts,origin:'CN',supplier:'',value:'1000.00',paid:'290.00',basePaid:null,additionalPaid:null,quantity:null,unit:'',chapter99:[],documents:[],evidenceOrigin:'',evidenceHts:'',exclusion:'',errors:[],warnings:[],raw:{label:'SYNTHETIC'}};
const decision=(patch:Partial<FactDecision>={}):FactDecision=>({row:1,kind:'confirm_facts',note:'SYNTHETIC qualification decision for a fictional product.',evidence:['SYNTHETIC-DOC'],validFrom:'2024-02-01',validBefore:'2024-03-01',exclusion:item.heading,exclusionScope:item.scope,facts:{exclusion_qualified:true},...patch});
function reference():AuditReference{return {release:{name:'2024HTSRev1',description:'SYNTHETIC source fixture',published_on:'2024-01-01',available_from:'2024-01-01',available_until:'2025-01-01'},rate:{source_id:'schedule',hts:item.hts,description:'SYNTHETIC',general:'4%',special:'',column2:'35%',additional_duties:'',units:[],footnotes:[]},sources:['schedule','notes','action','extension','metal'].map(id=>({id,release_name:'2024HTSRev1',kind:id==='notes'?'chapter99_pdf':'legal_document',url:`https://www.usitc.gov/SYNTHETIC-${id}`,title:'SYNTHETIC',original_sha256:'a'.repeat(64),captured_at:'2026-10-23T00:00:00Z'})),chapter99:['9903.88.02','9903.88.67'],chapter99Rates:[{source_id:'schedule',hts:'99038802',description:'SYNTHETIC',general:'The duty provided in the applicable subheading + 25%',special:'',column2:'',additional_duties:'',units:[],footnotes:[]}],legacyMeasures:[],stackingRules:[],gaps:[],contract:{compiler:'historical-301-reference-v2',coverageFrom:'2024-01-01',coverageBefore:'2025-01-01',noteSourceId:'notes',measures:[{heading:'9903.88.02',rate:'25%',legalEffectiveOn:'2018-08-23',hts8:['85013140'],exclusions:['9903.88.67','9903.88.69'],actionSourceIds:['action']}]},chapter99Contract:{compiler:'historical-chapter99-v1',from:'2024-01-01',before:'2025-01-01',exclusions:[item],metals:[]}};}
const run=(patch:Partial<AuditEntry>={},decisions:FactDecision[]=[],ref=reference())=>evaluateAuditEntry({...entry,...patch},[],'SYNTHETIC-PRODUCT',decisions,false,null,ref,true);

test('Chapter 99 codes normalize, deduplicate and reject malformed/foreign codes',()=>{
 assert.equal(chapter99Code('99038867'),'9903.88.67');assert.equal(chapter99Code('9903.88.67'),'9903.88.67');
 for(const s of ['8501.31.4000','990388','9903.88.6700','garbage99','99.0388.67x'])assert.equal(chapter99Code(s),null);
 assert.deepEqual(declaredChapter99('99038867;9903.88.67|9903.88.02').codes,['9903.88.67','9903.88.02']);
 assert.equal(declaredChapter99('9903.88.67 9903.88.02').errors.length,1);
});
test('an uploaded exclusion heading never establishes product qualification',()=>{
 const r=run({exclusion:item.heading,chapter99:[item.heading]});assert.equal(r.expected,null);assert(r.findings.some(f=>f.type==='exclusion_review'));assert.equal(r.factsUsed.exclusion_qualified,undefined);
 assert.equal(run({chapter99:[item.heading]}).expected,null);
});
test('a dated evidence decision removes only the matching 301 duty and preserves declarations',()=>{
 const r=run({},[decision()]);assert.equal(r.expected,'40.00');assert.equal(r.difference,'250.00');assert.equal(r.components.find(c=>c.id==='9903.88.02')?.amount,'0.00');assert.equal(r.appliedExclusion,item.heading);assert.equal(entry.exclusion,'');assert.equal(r.validation?.compiler,'historical-chapter99-v1');assert(r.findings.some(f=>f.type==='possible_missed_exclusion'));
});
test('exclusion qualification cannot escape evidence/date/scope checks',()=>{
 for(const d of [decision({evidence:[]}),decision({validFrom:'2024-03-01'}),decision({exclusionScope:'20(ttt)(ii)(99)'})])assert.equal(run({exclusion:item.heading},[d]).expected,null);
 for(const date of ['2024-01-01','2024-05-31','2024-06-01'])assert.equal(run({date,exclusion:item.heading},[decision({validFrom:'2024-01-01',validBefore:'2025-01-01'})]).expected,null);
 assert.equal(factDecisionSchema.safeParse(decision({facts:{exclusion_qualified:false}})).success,false);
});
test('multiple product definitions require an explicit reviewed choice',()=>{
 const ref=reference();ref.chapter99Contract!.exclusions.push({...item,scope:'20(ttt)(ii)(2)'});
 assert.equal(run({exclusion:item.heading},[decision({exclusionScope:undefined})],ref).expected,null);
 assert.equal(run({exclusion:item.heading},[decision()],ref).expected,'40.00');
});
test('rejected qualification retains the 301 duty and explains the incorrect claim',()=>{
 const r=run({exclusion:item.heading,chapter99:[item.heading]},[decision({exclusion:undefined,exclusionScope:undefined,facts:{exclusion_qualified:false}})]);assert.equal(r.expected,'290.00');assert(r.findings.some(f=>f.type==='chapter99_claim_mismatch'));assert.equal(r.chapter99?.unresolved.length,0);
});
test('unclaimed published exclusion is a lead; no money is silently deducted',()=>{
 const r=run();assert.equal(r.expected,'290.00');assert(r.findings.some(f=>f.type==='possible_exclusion'));assert.equal(r.chapter99?.exclusion,null);
});
test('unknown Chapter 99 claims withhold totals instead of being ignored',()=>{
 const r=run({chapter99:['9903.99.99']});assert.equal(r.expected,null);assert(r.findings.some(f=>f.type==='chapter99_review'));assert(r.chapter99?.unresolved.includes('9903.99.99'));
});
test('primary metal and 301 duties stack independently; a 301 exclusion does not exempt metal',()=>{
 const ref=reference();ref.chapter99Contract!.metals=[{heading:'9903.80.01',rate:'25%',legalEffectiveOn:'2018-03-23',prefixes:['8501'],except:[],sourceIds:['notes','metal'],requiresRussianAluminumClearance:false}];ref.chapter99.push('9903.80.01');
 assert.equal(run({},[],ref).expected,'540.00');
 const r=run({},[decision()],ref);assert.equal(r.expected,'290.00');assert.equal(r.components.find(c=>c.id==='9903.80.01')?.amount,'250.00');assert.equal(r.components.find(c=>c.id==='9903.88.02')?.amount,'0.00');
});
test('aluminum needs explicit evidence ruling out Russian smelt/cast treatment',()=>{
 const ref=reference();ref.chapter99Contract!.metals=[{heading:'9903.85.01',rate:'10%',legalEffectiveOn:'2018-03-23',prefixes:['8501'],except:[],sourceIds:['notes','metal'],requiresRussianAluminumClearance:true}];
 assert.equal(run({},[],ref).expected,null);assert.equal(run({},[decision({exclusion:undefined,exclusionScope:undefined,facts:{russian_aluminum_clear:true}})],ref).expected,'390.00');
 assert.equal(run({origin:'JP'},[],ref).expected,null);
});
test('synthetic source contract binds heading dates, exact product codes and target duties',()=>{
 const notes='SYNTHETIC SOURCE (ttt) (i) The U.S. Trade Representative determined to establish a process by which particular products classified in heading 9903.88.01 could be excluded. As provided in heading 9903.88.67, the additional duties provided for in heading 9903.88.01 shall not apply to the following particular products (1) Fictional product (described in statistical reporting number 8412.21.0045) (uuu) (i) Next note. Effective with respect to entries on or after October 12, 2021 and through May 31, 2024, articles the product of China, each covered by an exclusion granted by the U.S. Trade Representative. 9903.88.67 The duty provided in the applicable subheading';
 const input={release:'2024HTSRev1',from:'2024-01-25',before:'2024-05-31',noteId:'SYNTHETIC-NOTES',notes:notes.replace('As provided','as provided'),actions:[{id:'SYNTHETIC-ACTION',documentNumber:'2023-28770',text:'SYNTHETIC 9903.88.67 January 1, 2024 through May 31, 2024'}]};
 const c=proveHistoricalChapter99(input);assert.equal(c?.exclusions.length,1);assert.equal(c?.exclusions[0].hts,'8412210045');assert.equal(c?.exclusions[0].target,'9903.88.01');assert.equal(c?.exclusions[0].before,'2024-06-01');
 assert.equal(proveHistoricalChapter99({...input,actions:[]}),null);assert.equal(proveHistoricalChapter99({...input,release:'2025HTSRev1'}),null);
});

test('country-specific Russia headings require an exact dated description contract',()=>{
 const row={hts:'99039009',description:'Articles the product of the Russian Federation, as provided for in U.S. note 30(c) to this subchapter and as provided for in the subheadings enumerated in U.S. note 30(d) to this subchapter'};
 assert.equal(chapter99NonApplicability([row],'CN').length,1);assert.equal(chapter99NonApplicability([row],'RU').length,0);assert.equal(chapter99NonApplicability([{...row,description:row.description+' or China'}],'CN').length,0);
 const ref=reference();ref.chapter99.push('9903.90.09');ref.chapter99Rates.push({...ref.chapter99Rates[0],...row});
 const r=run({chapter99:['9903.90.09']},[],ref);assert.equal(r.expected,'290.00');assert.equal(r.chapter99?.unresolved.length,0);assert(r.findings.some(f=>f.type==='chapter99_claim_mismatch'));assert.equal(r.chapter99?.notApplicable?.[0].heading,'9903.90.09');
 assert.equal(run({origin:'RU'},[],ref).expected,null);
 ref.chapter99Rates[1].description+=' or China';assert.equal(run({},[],ref).expected,null);
});

test('published plus wording has the same narrow additive meaning; changed rates fail closed',()=>{
 const ref=reference();ref.chapter99Rates[0].general='The duty provided in the applicable subheading plus 25%';assert.equal(run({},[],ref).expected,'290.00');
 ref.chapter99Rates[0].general='The duty provided in the applicable subheading plus 35%';assert.equal(run({},[],ref).expected,null);
});

test('missing or changed primary metal contracts cannot silently produce base plus 301',()=>{
 const ref=reference();ref.rate!.hts='7604210010';ref.contract!.measures[0].hts8=['76042100'];ref.chapter99Contract!.exclusions=[];ref.chapter99Contract!.metals=[];
 assert.equal(run({hts:'7604210010'},[],ref).expected,null);
 delete ref.chapter99Contract;assert.equal(run({hts:'7604210010'},[],ref).expected,null);
});

test('a dated China-only duty claim is identified as inapplicable on a reviewed Vietnam origin',()=>{
 const r=run({chapter99:['9903.88.02']},[decision({origin:'VN',exclusion:undefined,exclusionScope:undefined,facts:{origin_verified:true}})]);assert.equal(r.appliedOrigin,'VN');assert.equal(r.expected,'40.00');assert.equal(r.difference,'250.00');assert.equal(r.chapter99?.unresolved.length,0);assert(r.chapter99?.notApplicable?.some(x=>x.heading==='9903.88.02'));assert(r.findings.some(f=>f.type==='chapter99_claim_mismatch'));
});

test('country explanations retain declared/referenced headings without listing unrelated China remedies',()=>{
 const ref=reference();ref.contract!.chinaOnlyHeadings=['9903.88.02','9903.88.67','9903.88.69','9903.88.99'];
 const r=run({origin:'VN',chapter99:['9903.88.02']},[],ref);assert.equal(r.expected,'40.00');assert(r.chapter99?.notApplicable?.some(x=>x.heading==='9903.88.02'));assert(!r.chapter99?.notApplicable?.some(x=>x.heading==='9903.88.99'));
});

test('the exact semiconductor heading remains China-only; another origin does not acquire its rate',()=>{
 const row={hts:'99039105',description:'Effective with respect to entries on or after January 1, 2025, articles the product of China, as provided for in subdivision (f) of U.S. note 31 to this subchapter'};
 assert.equal(chapter99NonApplicability([row],'VN')[0]?.heading,'9903.91.05');assert.deepEqual(chapter99NonApplicability([row],'CN'),[]);assert.deepEqual(chapter99NonApplicability([{...row,description:row.description.replace('China','China or Vietnam')}],'VN'),[]);
});

test('complete plain China-only note31 headings do not block other reviewed origins or broaden conditional scope',()=>{
 const first={hts:'99039101',description:'Effective with respect to entries on or after September 27, 2024, articles the product of China, as provided for in subdivision (b) of U.S. note 31 to this subchapter'};
 for(const origin of['MX','CA','VN','JP'])assert.equal(chapter99NonApplicability([first],origin)[0]?.heading,'9903.91.01');assert.equal(chapter99NonApplicability([first],'CN').length,0);
 const table=[['99039102','c'],['99039103','d'],['99039104','e'],['99039105','f'],['99039106','g'],['99039107','h'],['99039108','i'],['99039111','j'],['99039112','k']];for(const[hts,part]of table){const row={hts,description:first.description.replace('(b)','('+part+')')};assert.equal(chapter99NonApplicability([row],'MX').length,1);assert.equal(chapter99NonApplicability([{...row,description:row.description+' and goods made using Chinese components'}],'MX').length,0);}
 for(const row of[{...first,hts:'99039114'},{...first,description:first.description.replace('China','China or Mexico')},{...first,description:first.description.replace('(b)','(c)')},{...first,description:first.description.replace('September 27','February 31')},{...first,description:'Notwithstanding heading 9903.91.14, '+first.description},{...first,description:first.description+'; importer ownership also applies'}])assert.equal(chapter99NonApplicability([row],'MX').length,0);
});
