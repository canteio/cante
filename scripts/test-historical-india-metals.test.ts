/** Public clauses plus fictional source/entry facts: deterministic behavior only,
 * never approval, a binding classification or proof of real duty accuracy. */
import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import {indiaMetalHeadings,historicalMetals,resolveHistoricalMetals} from '../app/api/tariff/references/metal-history';
import {officialReferenceUrl} from '../app/api/tariff/references/ingestion';
import {validateCbpRuling} from '../app/api/tariff/references/cbp-guidance';
import type{ReferenceRate}from'../app/api/tariff/references/store';
const read=(name:string)=>readFileSync('scripts/test-fixtures/historical-audits/'+name,'utf8');
const note=read('india-note2z-2025.txt'),notes=read('copper-mixed-metal-notes-2025.txt')+' '+read('copper-note36-2025.txt')+' '+note;
const guidance=[
 {id:'SYNTHETIC-S1',number:'64384423',text:'SYNTHETIC March 12, 2025 9903.81.91'},
 {id:'SYNTHETIC-A1',number:'64384496',text:'SYNTHETIC March 12, 2025 9903.85.08'},
 {id:'SYNTHETIC-S2',number:'65236374',text:'SYNTHETIC June 4, 2025 50 percent duty rate; non-steel content is not subject to Reciprocal tariffs under HTS 9903.01.33'},
 {id:'SYNTHETIC-A2',number:'65236645',text:'SYNTHETIC June 4, 2025 50 percent duty rate; non-aluminum content is not subject to Reciprocal tariffs under HTS 9903.01.33'},
 {id:'SYNTHETIC-CU',number:'65794272',text:'SYNTHETIC entered for consumption on or after 12:01 a.m. eastern daylight time on August 1, 2025. 50 percent additional ad valorem rate of duty on the copper content; 0 percent additional ad valorem rate of duty; Section 232 duties on copper and copper derivative products are not applicable; If the value of the copper content cannot be determined, then report the duty based on the total entered value. When insufficient documentation is provided to substantiate the reported values.'},
 {id:'SYNTHETIC-IN',number:'66027027',text:'SYNTHETIC entered for consumption on or after 12:01 a.m. eastern daylight time on August 27, 2025. 9903.01.87: do not apply for such products that are provided for in headings'},
 {id:'SYNTHETIC-STOP',number:'67702087',text:'SYNTHETIC entered for consumption on or after 12:01 a.m. eastern time on February 7, 2026, no longer subject to 9903.01.84'},
];
const original={id:'SYNTHETIC-INDIA-ORIGINAL',documentNumber:'2025-16419',text:'SYNTHETIC entered for consumption on or after 12:01 a.m. eastern daylight time on August 27, 2025. The ad valorem duty provided for in new HTSUS heading 9903.01.84 applies in addition to all other applicable duties, taxes, fees, exactions, and charges, unless subject to existing or future actions under section 232 of the Trade Expansion Act of 1962, in which case the ad valorem duty imposed in Executive Order 14329 shall not apply. The ad valorem duty imposed SYNTHETIC next boundary.'};
const ruling={id:'SYNTHETIC-RULING',number:'N356087',text:'SYNTHETIC U.S. Customs and Border Protection N356087 December 9, 2025. For products covered by heading 9903.81.91 this additional duty applies to the non-steel content of the merchandise. The holding applies only to the specific factual situation.'};
const rows=[{hts:'99030187',general:'The duty provided in the applicable subheading'},{hts:'99038189',general:'The duty provided in the applicable subheading + 50%'},{hts:'99038508',general:'The duty provided in the applicable subheading + a duty of 50% upon the value of the aluminum content'},{hts:'99037801',general:'The duty provided in the applicable subheading + a duty of 50% upon the value of the copper content'},{hts:'99037802',general:'The duty provided in the applicable subheading'}] as ReferenceRate[];
const input={hts:'7317005503',origin:'IN',from:'2025-12-01',before:'2026-03-01',noteId:'SYNTHETIC-NOTE',notes,rows,guidance,actions:[original,{id:'SYNTHETIC-CU-ORIGINAL',documentNumber:'2025-14893',text:read('copper-original-clauses-2025.txt')}],rulings:[ruling]};
const common={hts:input.hts,date:'2025-12-15',origin:'IN',baseRate:'Free',baseInput:{value:'1000.00'},shipment:{steelValue:'800.00',aluminumValue:'100.00',copperValue:'50.00'},facts:{metal_special_claim:false,content_values_verified:true,steel_derivative_covered:true}};
function scope(patch:Partial<typeof input>={}){const s=historicalMetals({...input,...patch});assert(s);return s;}
test('all five original metal clauses are required; changed scope cannot become an India exemption',()=>{
 const headings=indiaMetalHeadings(note);assert.equal(headings?.length,13);assert(headings!.includes('9903.78.01'));assert(!headings!.includes('9903.85.68'));
 for(const changed of [note.replace('9903.81.88','9903.81.99'),note.replaceAll('shall not apply','shall apply'),note.replace('(ix) The additional duties','(xi) The additional duties')])assert.equal(indiaMetalHeadings(changed),null);
 assert.equal(indiaMetalHeadings('No complete India note'),null);
});
test('the proved India duty uses only the non-steel remainder, retaining unrelated metal values',()=>{
 const s=scope(),r=resolveHistoricalMetals(s,common);assert(s.earlier?.indiaProof);assert.deepEqual(r.issues,[]);assert.equal(r.indiaMode,'non_steel_content');assert.equal(r.reciprocalMode,'non_steel_content');
 for(const patch of [{actions:[]},{rulings:[]},{rulings:[{...ruling,text:ruling.text.replace('non-steel','entire')}]},{guidance:guidance.filter(g=>g.number!=='67702087')},{rows:rows.filter(r=>r.hts!=='99030187')},{actions:[{...original,text:original.text.replace('shall not apply','shall apply')}]}])assert(resolveHistoricalMetals(scope(patch),common).issues.length);
 // Ruling identity is checked independently at ingestion too.
 validateCbpRuling(ruling.text,ruling.number);assert.throws(()=>validateCbpRuling(ruling.text.replace('specific factual situation','all merchandise'),ruling.number));
});
test('mixed copper and aluminum subtract only both charged portions and require copper exception evidence',()=>{
 const hts='8544429090',s=scope({hts}),r=resolveHistoricalMetals(s,{...common,hts,shipment:{aluminumValue:'100.00',copperValue:'800.00',steelValue:'50.00'},facts:{...common.facts,copper_exceptions_clear:true,us_aluminum_smelt_cast:false,russian_aluminum_clear:true}});assert.deepEqual(r.issues,[]);assert.equal(r.indiaMode,'non_aluminum_copper_content');assert.equal(r.reciprocalMode,'non_aluminum_copper_content');
});
test('a full-value assessment exempts the full India basis; zero copper does not create an exemption',()=>{
 const hts='7408116000',s=scope({hts}),row={...common,hts,facts:{...common.facts,copper_exceptions_clear:true,copper_full_value_assessment:true}},full=resolveHistoricalMetals(s,row);assert.deepEqual(full.issues,[]);assert.equal(full.indiaMode,'exempt');
 const zero=resolveHistoricalMetals(s,{...row,shipment:{copperValue:'0.00'},facts:{...row.facts,copper_full_value_assessment:false}});assert.deepEqual(zero.issues,[]);assert.equal(zero.indiaMode,undefined);
});
test('the last active minute keeps India content allocation; at the ending cutoff it stops',()=>{
 const s=scope(),before=resolveHistoricalMetals(s,{...common,date:'2026-02-07',shipment:{...common.shipment,entryTimestamp:'2026-02-07T05:00:59Z'}}),after=resolveHistoricalMetals(s,{...common,date:'2026-02-07',shipment:{...common.shipment,entryTimestamp:'2026-02-07T05:01:00Z'}});assert.deepEqual(before.issues,[]);assert.equal(before.indiaMode,'non_steel_content');assert.deepEqual(after.issues,[]);assert.equal(after.indiaMode,undefined);
});
test('public ruling capture permits only bounded PDF URLs on the official host',()=>{
 assert.equal(officialReferenceUrl('https://rulings.cbp.gov/api/getdoc/ny/2025/N356087.pdf'),'https://rulings.cbp.gov/api/getdoc/ny/2025/N356087.pdf');
 for(const url of ['https://rulings.cbp.gov/api/getdoc/ny/2025/N356087.pdf?token=x','https://rulings.cbp.gov/search','https://rulings.cbp.gov.evil.test/api/getdoc/ny/2025/N356087.pdf','https://rulings.cbp.gov/api/getdoc/ny/2025/../../secret.pdf','https://rulings.cbp.gov/api/getdoc/ny/2025/N356087.pdf#fragment','https://rulings.cbp.gov:444/api/getdoc/ny/2025/N356087.pdf'])assert.throws(()=>officialReferenceUrl(url));
});
