/** Synthetic notices/rules test deterministic behavior, not legal validity. */
import test from 'node:test';import assert from 'node:assert/strict';
import {historicalPrograms} from '../app/api/tariff/references/program-history';import {evaluateAuditEntry} from '../app/api/audits/engine';import {cbpGuidanceText} from '../app/api/tariff/references/cbp-guidance';
import type {AuditEntry} from '../app/api/audits/model';import type {AuditReference,ReferenceRate} from '../app/api/tariff/references/store';
const table=(heading:string,part:string,next:string,codes=Array.from({length:20},(_,i)=>`1100.00.${String(i).padStart(2,'0')}`))=>`(${part}) As provided in heading ${heading}, the duty shall not apply to articles classifiable in the following provisions: ${codes.join(' ')} (${next}) As provided in the next provision. `;
const guidance=[
 {id:'fent',number:'64299816',text:'SYNTHETIC February 4, 2025 through March 3, 2025; March 4, 2025. Duty applies in addition to all other applicable duties. 9903.01.20: All imports of articles of China additional ad valorem rate of duty of 10%. 9903.01.24: All imports of articles of China additional ad valorem rate of duty of 20%.'},
 {id:'scope',number:'64680374',text:'SYNTHETIC April 5, 2025 in addition to any other duties 9903.01.34 at least 20%. 9903.01.25: Additional ad valorem duty rate of 10%'},
 {id:'april',number:'64701128',text:'SYNTHETIC April 10, 2025. The country-specific rates that became effective on April 9, 2025 are suspended. 9903.01.63: Articles of China duty of 125%. 9903.01.25: Articles of other countries duty rate of 10%.'},
 {id:'stop',number:'67834313',text:'SYNTHETIC February 24, 2026 Executive Order 14195 Executive Order 14257 will no longer be collected; does not affect any other duties.'},
 {id:'surcharge',number:'67844987',text:'SYNTHETIC February 24, 2026 through July 24, 2026 under heading 9903.03.01: Except for headings 9903.03.02 to 9903.03.11 subject to an additional ad valorem rate of 10%.'},
];
const entry=(date:string):AuditEntry=>({row:1,entry:'SYNTHETIC',line:'1',date,sku:'SYNTHETIC',description:'Fictional test declaration',hts:'8501314000',origin:'CN',supplier:'',value:'1000.00',paid:'300.00',basePaid:null,additionalPaid:null,quantity:null,unit:'',chapter99:[],documents:[],evidenceOrigin:'',evidenceHts:'',exclusion:'',errors:[],warnings:[],raw:{synthetic:'true'}});
function fixture(date:string,hts='8501314000'){
 const e={...entry(date),hts},rows:ReferenceRate[]=[{source_id:'notes',hts:'99030531',description:'SYNTHETIC articles the product of China',general:'The duty provided in the applicable subheading + 12.5%',special:'',column2:'',additional_duties:'',units:[],footnotes:[]}];
 const notes='SYNTHETIC '+table('9903.01.32','iii','iv')+' (aa) heading 9903.03.01 imposes duties and shall also be subject to any additional duty. '+table('9903.03.03','ii','iii')+'52. (a) Notwithstanding U.S. note 1, goods shall also be subject to any additional duty. '+table('9903.05.86','b','c'),programs=historicalPrograms({date,hts,origin:'CN',from:date.slice(0,4)+'-01-01',before:String(Number(date.slice(0,4))+1)+'-01-01',noteId:'notes',notes,rows,guidance,actions:[{id:'country',documentNumber:'2026-15181',text:'SYNTHETIC July 24, 2026 9903.05.20 9903.05.84'}]});
 const ref:AuditReference={programs,...(date>='2025-08-01'&&date<'2026-04-06'?{metals:{compiler:'historical-metals-2025-v3' as const,hts,from:date,before:'2026-04-06',lists:[],rows:[],sourceIds:['notes'],overlapExemptions:{section122:false,country301:false},earlier:{members:[],increased:true,cutoffs:[],reciprocalProof:true,copper:{listed:false,sourceIds:['notes'],issues:[]}}}}:{}),...(date>='2026-06-08'?{metals:{compiler:'historical-metals-v1' as const,hts,from:'2026-06-08',before:'2027-01-01',lists:[],rows:[],sourceIds:['notes'],overlapExemptions:{section122:false,country301:false}}}:{}),sources:['schedule','notes','action','country',...guidance.map(g=>g.id)].map(id=>({id,release_name:null,kind:'legal_document',url:'https://www.usitc.gov/SYNTHETIC-'+id,title:'SYNTHETIC',original_sha256:'a'.repeat(64),captured_at:'2026-10-24T00:00:00Z'})),release:{name:date.slice(0,4)+'HTSBasic',description:'SYNTHETIC',published_on:date.slice(0,4)+'-01-01',available_from:date.slice(0,4)+'-01-01',available_until:String(Number(date.slice(0,4))+1)+'-01-01'},rate:{source_id:'schedule',hts,description:'SYNTHETIC',general:'4%',special:'',column2:'',additional_duties:'',units:[],footnotes:[]},chapter99:['9903.88.02'],chapter99Rates:[{...rows[0],hts:'99038802',general:'The duty provided in the applicable subheading + 25%'}],contract:{compiler:'historical-301-reference-v2',coverageFrom:date.slice(0,4)+'-01-01',coverageBefore:String(Number(date.slice(0,4))+1)+'-01-01',noteSourceId:'notes',measures:[{heading:'9903.88.02',rate:'25%',legalEffectiveOn:'2018-08-23',hts8:[hts.slice(0,8)],exclusions:[],actionSourceIds:['action']}]},legacyMeasures:[],stackingRules:[],gaps:[]};return {e,ref};
}
test('same shipment value has distinct dated stacked duties; no current-rate substitution',()=>{
 for(const [date,expected]of [['2025-02-15','390.00'],['2025-03-15','490.00'],['2025-04-15','1740.00'],['2026-03-15','390.00'],['2026-08-15','415.00']]){const {e,ref}=fixture(date);assert.deepEqual(ref.programs!.issues,[]);const r=evaluateAuditEntry(e,[],'SYNTHETIC',[],false,null,ref,true,true);assert.equal(r.expected,expected,JSON.stringify(r.findings));assert.equal(r.validation?.compiler,'historical-programs-v1');}
});
test('required program facts are not inferred from a standard-coverage checkbox or an older saved option',()=>{
 const {e,ref}=fixture('2025-04-15');assert.equal(evaluateAuditEntry(e,[],'SYNTHETIC',[],false,null,ref,true).expected,null);const r=evaluateAuditEntry(e,[],'SYNTHETIC',[],false,null,ref,true,true);assert.equal(r.expected,'1740.00');assert.equal(r.factsUsed.reciprocal_exceptions_clear,true);
});
test('unknown or rejected program qualification never displays that program as an applied amount',()=>{
 const {e,ref}=fixture('2025-04-15'),unknown=evaluateAuditEntry(e,[],'SYNTHETIC',[],false,null,ref,true);
 assert.equal(unknown.expected,null);assert(!unknown.components.some(c=>['9903.01.24','9903.01.63'].includes(c.id)));
 const rejected=evaluateAuditEntry(e,[],'SYNTHETIC',[{row:e.row,kind:'confirm_facts',note:'SYNTHETIC evidence requires separate reciprocal exception treatment.',evidence:['SYNTHETIC-DOC'],validFrom:'2025-01-01',validBefore:'2026-01-01',facts:{reciprocal_exceptions_clear:false}}],false,null,ref,true,true);
 assert.equal(rejected.expected,null);assert(!rejected.components.some(c=>c.id==='9903.01.63'));assert(rejected.components.some(c=>c.id==='9903.01.24'));
});
test('a complete published HTS-only exemption applies automatically and removes only its own program',()=>{
 const {e,ref}=fixture('2025-04-15','1100000100');assert.equal(ref.programs!.measures.find(m=>m.heading==='9903.01.32')?.rate,'Free');const r=evaluateAuditEntry(e,[],'SYNTHETIC',[],false,null,ref,true,true);assert.equal(r.expected,'490.00');assert(!r.components.some(c=>c.id==='9903.01.63'));assert(r.components.some(c=>c.id==='9903.01.32'&&c.amount==='0.00'));assert.equal(ref.programs!.notApplicable[0].heading,'9903.01.63');
});
test('unknown/mismatched scope, changed source contracts and cutoff days cannot gain a total',()=>{
 for(const date of ['2025-02-04','2025-04-10','2026-02-24','2026-07-24']){const {e,ref}=fixture(date);assert.equal(evaluateAuditEntry(e,[],'SYNTHETIC',[],false,null,ref,true,true).expected,null);}
 const {e,ref}=fixture('2025-04-15');ref.programs!.origin='VN';assert.equal(evaluateAuditEntry(e,[],'SYNTHETIC',[],false,null,ref,true,true).expected,null);delete ref.programs;assert.equal(evaluateAuditEntry(e,[],'SYNTHETIC',[],false,null,ref,true,true).expected,null);
 const p=fixture('2026-03-15');p.ref.programs!.issues.push('Original government source unavailable.');assert.equal(evaluateAuditEntry(p.e,[],'SYNTHETIC',[],false,null,p.ref,true,true).expected,null);
});
test('official guidance parser requires its bounded CBP identity and strips executable markup',()=>{
 const html=Buffer.from('<body>U.S. Customs and Border Protection Cargo Systems Messaging Service CSMS # 64299816 <script>bad()</script>SYNTHETIC text</body>');assert(!cbpGuidanceText(html,'64299816').includes('bad()'));assert.throws(()=>cbpGuidanceText(html,'00000000'),/identity/);assert.throws(()=>cbpGuidanceText(Buffer.alloc(1000001),'64299816'),/bounded/);
});

test('published combined-rate pairs replace the base exactly, including cent-rounding edge cases',async()=>{
 const {combinedHeading}=await import('../app/api/tariff/references/combined-heading');
 const sample=fixture('2026-08-15'),base=sample.ref.chapter99Rates[0],rows=[{...base,hts:'99030538',description:'SYNTHETIC equal to or greater than 10 percent',general:'The duty provided in the applicable subheading'},{...base,hts:'99030539',description:'SYNTHETIC less than 10 percent',general:'10%'}];
 assert.equal(combinedHeading(rows,'4%')?.replacesBase,true);assert.equal(combinedHeading(rows,'10%')?.rate,'Free');assert.equal(combinedHeading(rows,'12%')?.rate,'Free');assert.equal(combinedHeading(rows,'3 cents/kg'),null);assert.equal(combinedHeading(rows.slice(1),'4%'),null);
 const ref=sample.ref;ref.programs!.measures=[{heading:'9903.05.39',label:'SYNTHETIC combined country Section 301 duty',rate:'10%',from:'2026-07-24',before:'2027-01-01',requiredFacts:[],sourceIds:['notes','country'],replacesBase:true}];ref.contract!.measures=[];ref.contract!.completeScope=true;ref.chapter99=[];
 const r=evaluateAuditEntry({...sample.e,value:'0.05',paid:'0.01'},[],'SYNTHETIC',[],false,null,ref,true,true);assert.equal(r.expected,'0.01');assert.equal(r.components.find(c=>c.id==='base')?.amount,'0.00');assert.equal(r.components.find(c=>c.id==='9903.05.39')?.amount,'0.01');
});
test('combined-rate equivalents use the complete payable compound duty and explicit matching quantity',async()=>{
 const{baseBelowThreshold}=await import('../app/api/tariff/references/combined-heading');assert.equal(baseBelowThreshold('50 cents/kg','15%',{value:'10.00',quantity:'1',unit:'kg'}),true);assert.equal(baseBelowThreshold('50 cents/kg','15%',{value:'10.00',quantity:'3',unit:'kg'}),false);assert.equal(baseBelowThreshold('50 cents/kg + 12%','15%',{value:'10.00',quantity:'1',unit:'kg'}),false);assert.equal(baseBelowThreshold('50 cents/kg','15%',{value:'10.00',quantity:'1',unit:'lb'}),null);assert.equal(baseBelowThreshold('50 cents/kg','15%',{value:'0.00',quantity:'1',unit:'kg'}),null);
});
const countryGuidance=[...guidance,
 {id:'aug',number:'65829726',text:'SYNTHETIC August 7, 2025 9903.02.'},
 {id:'extend',number:'65573545',text:'SYNTHETIC August 1, 2025 additional ad valorem duty rate of 10%'},
 {id:'japan',number:'66242844',text:'SYNTHETIC August 7, 2025 9903.02.72 9903.02.73. Column 1 duty rate greater than or equal to 15 percent, the additional reciprocal tariff is zero. The sum of the Column 1 and the reciprocal tariff rate is 15 percent.'},
 {id:'korea',number:'67045953',text:'SYNTHETIC November 14, 2025 9903.02.79 9903.02.80. Column 1 (General or Special, whichever is applicable) duty rate greater than or equal to 15 percent ad valorem, the additional Reciprocal tariff is zero. The combined Column 1 and Reciprocal tariff rate is 15 percent.'},
 {id:'india',number:'66027027',text:'SYNTHETIC August 27, 2025 9903.01.84 applies in addition to the additional duty. Goods will be subject to an additional ad valorem rate of 25%. Exemptions identified in Annex II.'},
 {id:'india-stop',number:'67702087',text:'SYNTHETIC February 7, 2026 no longer subject to 9903.01.84.'},
];
function countryProgram(date:string,origin:string,base='4%'){
 const notes=table('9903.01.32','iii','iv'),sample=fixture(date),rows=[{...sample.ref.chapter99Rates[0],hts:origin==='IN'?'99030226':'99030256',description:'SYNTHETIC articles the product of '+(origin==='IN'?'India':'South Korea'),general:'The duty provided in the applicable subheading + '+(origin==='IN'?'25':'15')+'%'}],actions=[{id:'extension-action',documentNumber:'2025-15010',text:'SYNTHETIC July 31, 2025 7 days after the date of this order continuing to suspend headings 9903.01.43 until the effective date of the modifications provided in Annex II'}];
 return historicalPrograms({date,origin,hts:'8501314000',baseRate:base,from:'2025-01-01',before:'2026-02-24',noteId:'notes',notes,rows,guidance:countryGuidance,actions});
}
test('Japan/Korea retroactive combined instructions replace the original country heading without erasing other programs',()=>{
 for(const[date,origin,heading]of [['2025-08-15','JP','9903.02.73'],['2025-12-15','KR','9903.02.80']]){const p=countryProgram(date,origin);assert.deepEqual(p.issues,[]);assert.equal(p.measures[0].heading,heading);assert.equal(p.measures[0].rate,'15%');assert.equal(p.measures[0].replacesBase,true);assert(p.notApplicable.length);const high=countryProgram(date,origin,'20%');assert.equal(high.measures[0].rate,'0%');assert.equal(high.measures[0].replacesBase,undefined);}
 const before=countryProgram('2025-09-15','KR');assert.equal(before.measures[0].rate,'15%');assert(!before.measures[0].replacesBase);
});
test('India additional duties stack independently, stop on the established date, and require the original instructions',()=>{
 const p=countryProgram('2025-09-15','IN');assert.deepEqual(p.issues,[]);assert.deepEqual(p.measures.map(m=>m.rate),['25%','25%']);assert(p.measures.some(m=>m.heading==='9903.01.84'&&m.before==='2026-02-07'));
 const after=countryProgram('2026-02-15','IN');assert.deepEqual(after.issues,[]);assert.equal(after.measures.length,1);assert(after.notApplicable.some(m=>m.heading==='9903.01.84'));assert(countryProgram('2026-02-07','IN').issues.length);
});
test('August 1–6 extension uses the original seven-day suspension and keeps the prior rate',()=>{
 for(const day of ['2025-08-01','2025-08-04']){const p=countryProgram(day,'VN');assert.deepEqual(p.issues,[]);assert.equal(p.measures[0].rate,'10%');assert(p.measures[0].sourceIds.includes('extension-action'));assert.equal(p.measures[0].before,'2025-08-07');assert.equal(p.measures[0].from,'2025-04-10');}
});

test('a newer date needs a complete metal-scope proof even for a seemingly nonmetal product',()=>{const sample=fixture('2026-08-15');delete sample.ref.metals;assert.equal(evaluateAuditEntry(sample.e,[],'SYNTHETIC',[],false,null,sample.ref,true,true).expected,null);});

test('EU ordinary combined pair stays distinct from separately qualified EU exception headings',async()=>{
 const{readFileSync}=await import('node:fs');const original=JSON.parse(readFileSync('scripts/test-fixtures/historical-audits/eu-reciprocal-public-rows.json','utf8'));
 const input={date:'2025-10-15',hts:'9401614011',origin:'DE',from:'2025-10-10',before:'2025-10-31',noteId:'notes',notes:'SYNTHETIC '+table('9903.01.32','iii','iv'),rows:original.rows,baseRate:'Free',guidance:[...guidance,{id:'SYNTHETIC-AUG7',number:'65829726',text:'SYNTHETIC August 7, 2025 9903.02.'}],actions:[]};
 const result=historicalPrograms(input);assert.deepEqual(result.issues,[]);assert.equal(result.measures.find(m=>m.heading==='9903.02.20')?.rate,'15%');assert.equal(result.measures.find(m=>m.heading==='9903.02.20')?.replacesBase,true);
 const duplicate=historicalPrograms({...input,rows:[...original.rows,original.rows.find((r:any)=>r.hts==='99030220')]});assert(duplicate.issues.length);
 const foreign=historicalPrograms({...input,rows:original.rows.map((r:any)=>({...r,description:r.description.replaceAll('European Union','European Union or Japan')}))});assert(foreign.issues.length);
});
