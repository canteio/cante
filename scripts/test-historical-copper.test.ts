/** Government scope excerpts, fictional notices/entries. These tests validate
 * deterministic compiler behavior, not the legal accuracy of real shipments. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {earlierCopperList,historicalMetals,resolveHistoricalMetals} from '../app/api/tariff/references/metal-history';
import {evaluateAuditEntry} from '../app/api/audits/engine';
import {bundleSchema,type AuditEntry,type RuleBundle} from '../app/api/audits/model';
import type {ReferenceRate} from '../app/api/tariff/references/store';
const read=(name:string)=>readFileSync('scripts/test-fixtures/historical-audits/'+name,'utf8');
const copper=read('copper-note36-2025.txt'),notes=read('copper-metal-notes-2025.txt')+' '+copper;
const original={id:'SYNTHETIC-COPPER-ORIGINAL',documentNumber:'2025-14893',text:read('copper-original-clauses-2025.txt')};
const guidance=[
 {id:'SYNTHETIC-S1',number:'64384423',text:'SYNTHETIC March 12, 2025 9903.81.91'},
 {id:'SYNTHETIC-A1',number:'64384496',text:'SYNTHETIC March 12, 2025 9903.85.08'},
 {id:'SYNTHETIC-S2',number:'65236374',text:'SYNTHETIC June 4, 2025 50 percent duty rate; non-steel content is not subject to Reciprocal tariffs under HTS 9903.01.33'},
 {id:'SYNTHETIC-A2',number:'65236645',text:'SYNTHETIC June 4, 2025 50 percent duty rate; non-aluminum content is not subject to Reciprocal tariffs under HTS 9903.01.33'},
 {id:'SYNTHETIC-CU',number:'65794272',text:'SYNTHETIC entered for consumption on or after 12:01 a.m. eastern daylight time on August 1, 2025. 50 percent additional ad valorem rate of duty on the copper content; 0 percent additional ad valorem rate of duty; Section 232 duties on copper and copper derivative products are not applicable; If the value of the copper content cannot be determined, then report the duty based on the total entered value. When insufficient documentation is provided to substantiate the reported values.'},
 {id:'SYNTHETIC-STACK',number:'65236574',text:'SYNTHETIC June 4, 2025 more than 0% is owed; then the article IS NOT subject to the IEEPA Canada or IEEPA Mexico tariffs'},
];
const rows=[{hts:'99037801',general:'The duty provided in the applicable subheading + a duty of 50% upon the value of the copper content'},{hts:'99037802',general:'The duty provided in the applicable subheading'},{hts:'99038508',general:'The duty provided in the applicable subheading + a duty of 50% upon the value of the aluminum content'}] as ReferenceRate[];
const input={hts:'7408116000',from:'2025-08-01',before:'2025-08-07',noteId:'SYNTHETIC-NOTE',notes,rows,guidance,actions:[original]};
function scope(overrides:Partial<typeof input>={}){const s=historicalMetals({...input,...overrides});assert(s);return s;}
const common={hts:input.hts,date:'2025-08-02',origin:'CN',baseRate:'3%',baseInput:{value:'1000.00'},shipment:{copperValue:'800.00',copperQuantityKg:'25'},facts:{metal_special_claim:false,copper_exceptions_clear:true,content_values_verified:true}};
test('complete copper scope has 80 unique exact eight-digit codes; altered scope and prose fail closed',()=>{
 const list=earlierCopperList(copper);assert(list);assert.equal(list.length,80);assert(list.includes('74081160'));assert(list.includes('85444290'));assert(!list.includes('74081100'));
 for(const changed of [copper.replace('7408.11.60','7408.11.60 7408.11.60'),copper.replace('shall only apply','shall always apply'),copper.replace('permit the administration of these headings.','')])assert.equal(earlierCopperList(changed),null);
 // A basic-edition page header is layout only, not a deleted rule clause.
 assert.deepEqual(earlierCopperList(copper.replace('(b) The rates','Harmonized Tariff Schedule of the United States (2026) Annotated for Statistical Reporting Purposes XXII 99 - III - 211 U.S. Notes (con.) (b) The rates')),list);
 assert.equal(historicalMetals({...input,notes:read('metal-notes-2025.txt')}),null);
});
test('copper content charges 50% only on the evidenced copper portion and retains the other portion',()=>{
 const s=scope(),r=resolveHistoricalMetals(s,common);assert.deepEqual(r.issues,[]);assert.equal(r.measures[0].basis,'copper_content');assert.equal(r.measures[0].quantityBasis,'copper_content');assert.equal(r.measures[1].id,'9903.78.02');assert.equal(r.reciprocalMode,'non_copper_content');assert.notEqual(r.borderExempt,true);
 const zero=resolveHistoricalMetals(s,{...common,shipment:{copperValue:'0.00'}});assert.deepEqual(zero.issues,[]);assert.equal(zero.measures.length,1);assert.equal(zero.measures[0].rate,'Free');assert.equal(zero.reciprocalMode,undefined);
});
test('missing copper valuation or exceptions cannot silently become a full-value charge',()=>{
 const s=scope();for(const missing of [{...common,shipment:{}},{...common,facts:{...common.facts,copper_exceptions_clear:false}},{...common,facts:{...common.facts,content_values_verified:false}}])assert(resolveHistoricalMetals(s,missing).issues.length);
 const full=resolveHistoricalMetals(s,{...common,shipment:{},facts:{...common.facts,copper_full_value_assessment:true}});assert.deepEqual(full.issues,[]);assert.equal(full.measures[0].basis,'customs_value');assert.equal(full.reciprocalMode,'exempt');
 const noProof=scope({guidance:guidance.map(g=>({...g,text:g.text.replace('When insufficient documentation is provided to substantiate the reported values','Changed valuation instruction')}))});assert(resolveHistoricalMetals(noProof,{...common,facts:{...common.facts,copper_full_value_assessment:true}}).issues.length);
});
test('copper original clauses, exact published rate and effective timestamp are required',()=>{
 for(const bad of [{actions:[]},{actions:[{...original,text:original.text.replace('The non-copper content','The entire content')}]},{actions:[{...original,text:original.text.replace('and not those imposed','and also those imposed')}]},{rows:rows.map(r=>({...r,general:r.general.replace('copper content','full value')}))}]){const s=scope(bad);assert(resolveHistoricalMetals(s,common).issues.length);}
 const s=scope(),first={...common,date:'2025-08-01'};assert(resolveHistoricalMetals(s,first).issues.length);assert(resolveHistoricalMetals(s,{...first,shipment:{...first.shipment,entryTimestamp:'2025-08-01T04:00:59Z'}}).issues.length);assert.deepEqual(resolveHistoricalMetals(s,{...first,shipment:{...first.shipment,entryTimestamp:'2025-08-01T04:01:00Z'}}).issues,[]);
 const unlisted=scope({hts:'8501314000',actions:[],guidance:guidance.filter(g=>g.number!=='65794272')});assert.equal(unlisted.earlier!.copper!.listed,false);assert.deepEqual(unlisted.earlier!.copper!.issues,[]);
});
test('mixed aluminum and copper allocate only charged portions; wrong-metal rate wording is rejected',()=>{
 const hts='8544429090',mixed={hts,from:'2025-09-08',before:'2025-09-26',notes:read('copper-mixed-metal-notes-2025.txt')+' '+copper},s=scope(mixed),row={...common,hts,date:'2025-09-15',shipment:{copperValue:'800.00',aluminumValue:'100.00',steelValue:'50.00'},facts:{...common.facts,us_aluminum_smelt_cast:false,russian_aluminum_clear:true}},r=resolveHistoricalMetals(s,row);assert.deepEqual(r.issues,[]);assert(r.measures.some(m=>m.id==='9903.85.08'));assert.equal(r.reciprocalMode,'non_aluminum_copper_content');
 const changed=scope({...mixed,rows:rows.map(r=>({...r,general:r.hts==='99038508'?r.general.replace('aluminum content','steel content'):r.general}))});assert(resolveHistoricalMetals(changed,row).issues.length);
});
test('copper-only imports do not inherit the steel/aluminum Canada border exemption',()=>{
 for(const origin of ['CA','MX']){const r=resolveHistoricalMetals(scope(),{...common,origin});assert.deepEqual(r.issues,[]);assert.notEqual(r.borderExempt,true);assert.equal(r.measures[0].rate,'50%');}
});
test('copper kilograms remain separate from commodity quantities, including optional missing filing weight',()=>{
 const e:AuditEntry={row:1,entry:'SYNTHETIC',line:'1',date:'2025-08-02',sku:'SYNTHETIC',description:'Fictional copper quantity',hts:input.hts,origin:'CN',supplier:'',value:'1000.00',paid:'500.00',basePaid:null,additionalPaid:null,quantity:'2',unit:'No.',chapter99:[],documents:[],evidenceOrigin:'',evidenceHts:'',exclusion:'',errors:[],warnings:[],raw:{synthetic:'true'},shipment:{copperValue:'800.00',copperQuantityKg:'25'}};
 const definition=bundleSchema.parse({version:1,synthetic:true,title:'SYNTHETIC Cu quantity test',supersedes:[],coverage:[{hts:[e.hts],origins:['CN'],from:'2025-08-01',before:'2025-08-07',requiredFacts:[],sourceIds:['SYNTHETIC']}],measures:[{id:'base',label:'SYNTHETIC base',type:'base',hts:[e.hts],origins:['CN'],from:'2025-08-01',before:'2025-08-07',rate:'3%',sourceIds:['SYNTHETIC']},{id:'copper',label:'SYNTHETIC copper',type:'section232',hts:[e.hts],origins:['CN'],from:'2025-08-01',before:'2025-08-07',rate:'50%',basis:'copper_content',quantityBasis:'copper_content',sourceIds:['SYNTHETIC']}],stacking:[]});
 const bundle:RuleBundle={id:'SYNTHETIC',definition,sources:[{id:'SYNTHETIC',url:'https://www.usitc.gov/SYNTHETIC',title:'SYNTHETIC',sha256:'a'.repeat(64),body:'',encoding:'utf8',capturedAt:'2025-08-01T00:00:00Z'}],status:'draft',approved_by:null,approved_at:null};
 const decisions=[{row:1,kind:'confirm_facts' as const,note:'SYNTHETIC valuation evidence',evidence:['SYNTHETIC'],validFrom:'2025-08-01',validBefore:'2025-08-07',facts:{content_values_verified:true}}];definition.measures.push({...definition.measures[1],id:'zero-remainder',label:'SYNTHETIC zero-duty remainder',rate:'Free',basis:'non_copper_content',quantityBasis:undefined});const r=evaluateAuditEntry(e,[bundle],'SYNTHETIC',decisions,true);assert.equal(r.expected,'430.00',JSON.stringify(r.findings));assert.equal(r.components[1].quantity,'25');assert.equal(r.components[1].unit,'kg');assert.equal(r.components[0].quantity,'2');assert.equal(r.components[2].assessedValue,'200.00');
 const missing=evaluateAuditEntry({...e,shipment:{copperValue:'800.00'}},[bundle],'SYNTHETIC',decisions,true);assert.equal(missing.expected,'430.00');assert.equal(missing.components[1].quantity,null);assert.match(missing.components[1].explanation,/kilograms were not supplied/);
 const freeOnly={...bundle,definition:{...definition,measures:definition.measures.filter(m=>m.id!=='copper')}};const unknown=evaluateAuditEntry({...e,shipment:{}},[freeOnly],'SYNTHETIC',[],true);assert.equal(unknown.expected,'30.00');assert.equal(unknown.components[1].assessedValue,null);
});
