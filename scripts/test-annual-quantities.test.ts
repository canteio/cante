/** Public source excerpts, fictional identities and declared quantities. These
 * exercise deterministic functionality, not legal origin/classification proof. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {annualForEntry,annualQuantityCodeContract,hasAnnualQuantityFieldsContract,annualQuantityComputation,type AnnualRow} from '../app/api/tariff/references/annual-data';
import {proveOrdinaryCountryContract} from '../app/api/tariff/references/ordinary-contract';
import {computeExactDutySum} from '../lib/tariff/duty-expression';
import {evaluateAuditEntry} from '../app/api/audits/engine';
import {auditBlockers} from '../app/api/audits/readiness';
import {exportAudit} from '../app/api/audits/store';
import {AUDIT_VERSION,type AuditEntry,type FactDecision} from '../app/api/audits/model';
import type {AuditReference} from '../app/api/tariff/references/store';
const code=readFileSync('scripts/test-fixtures/historical-audits/annual-quantity-code-key.txt','utf8'),fields=readFileSync('scripts/test-fixtures/historical-audits/annual-quantity-fields.txt','utf8'),units=annualQuantityCodeContract(code),proof={id:'SYNTHETIC-KEY',valid:true,quantityUnits:units,fieldsSourceId:'SYNTHETIC-FIELDS'};
const country=proveOrdinaryCountryContract('SYNTHETIC. Harmonized Tariff Schedule of the United States (2014). rates of duty in column 1 are rates which are applicable to all products other than those of countries enumerated in paragraph (b) of this note. "General" subcolumn sets forth the general or normal trade relations (NTR) rates. (b) Rate of Duty Column 2. rates shall apply to products of the following countries: Cuba North Korea (c) Products Eligible for Special Tariff Treatment.',2014,'SYNTHETIC-NOTES')!;assert(country,'Complete synthetic country-note contract is required.');
const entry:AuditEntry={row:1,entry:'SYNTHETIC-QUANTITY',line:'1',date:'2014-06-15',sku:'SYNTHETIC',description:'Fictional declared goods',hts:'6505000800',origin:'JP',supplier:'',value:'1000.00',paid:'100.00',basePaid:null,additionalPaid:null,quantity:'100',unit:'NO',shipment:{quantity2:'25',unit2:'KG'},chapter99:[],documents:[],evidenceOrigin:'',evidenceHts:'',exclusion:'',errors:[],warnings:[],raw:{label:'SYNTHETIC'}};
const row:AnnualRow={record:1,hts8:'65050008',description:'Published legal-line example, fictional declaration',from:'2014-01-01',through:'2014-12-31',rateType:'6',adValorem:'0.063',specific:'0.019',other:'0.135',textRate:'13.5 cents/kg + 6.3% + 1.9 cents/article',special:'',column2:'',units:['NO','KG'],quantityCodes:['NO','KG'],footnote:'',additional:''};
function reference(r:AnnualRow=row):AuditReference{return{annual:annualForEntry([r],2014,'SYNTHETIC-ANNUAL',entry,proof),ordinaryCountry:country,sources:['SYNTHETIC-ANNUAL','SYNTHETIC-KEY','SYNTHETIC-NOTES','SYNTHETIC-FIELDS'].map(id=>({id,release_name:null,kind:'legal_document',url:'https://www.usitc.gov/SYNTHETIC-'+id,title:'SYNTHETIC source identity',original_sha256:'a'.repeat(64),captured_at:'2026-10-27T00:00:00Z'})),release:null,rate:null,chapter99:[],chapter99Rates:[],stackingRules:[],legacyMeasures:[],gaps:[]};}
const run=(e=entry,r=row,decisions:FactDecision[]=[])=>evaluateAuditEntry(e,[],'SYNTHETIC-PRODUCT',decisions,false,null,reference(r),true);
test('all six published quantity equations and unit meanings need their complete source contracts',()=>{
 assert(hasAnnualQuantityFieldsContract(fields));assert(units.includes('KG')&&units.includes('CKG')&&units.includes('NO')&&units.includes('PFL'));assert(!units.includes('NA')&&!units.includes('X'));
 assert.deepEqual(annualQuantityCodeContract(code.replace('2 Specific rate*Q2','2 Specific rate*Q1')),[]);assert(!hasAnnualQuantityFieldsContract(fields.replace('(.05 = $.05 per unit of quantity)','(.05 = 5 dollars)')));
 assert(!annualQuantityCodeContract(code.replace('KG kilograms','KG pounds')).includes('KG'));
 for(const changed of [{...row,quantityCodes:undefined},{...row,quantityCodes:['NO','NA'] as [string,string]},{...row,quantityCodes:['KG','KG'] as [string,string]},{...row,rateType:'T'},{...row,rateType:'9'},{...row,issue:'Invalid original dates'}])assert.equal(annualQuantityComputation(changed,units,proof.fieldsSourceId),null);
});
test('complete printed text corroborates every amount and quantity meaning',()=>{
 assert(annualQuantityComputation(row,units,proof.fieldsSourceId));for(const textRate of [row.textRate.replace('6.3%','7.3%'),row.textRate+' + 2%',row.textRate.replace('kg','liters'),row.textRate+' if below 500 kg','',row.textRate.replace('1.9 cents/article','1.9 cents/kg')])assert.equal(annualQuantityComputation({...row,textRate},units,proof.fieldsSourceId),null,textRate);
});
test('an absent legacy text column is different from an empty or conflicting modern value',()=>{
 assert(annualQuantityComputation({...row,textRate:'',textRateAvailable:false},units,proof.fieldsSourceId));
 assert.equal(annualQuantityComputation({...row,textRate:'',textRateAvailable:true},units,proof.fieldsSourceId),null);
 assert.equal(annualQuantityComputation({...row,specific:'0.01'},units,proof.fieldsSourceId),null,'A rounded numeric field cannot override more precise printed text.');
 const unresolved=run(entry,{...row,specific:'0.01'});assert.equal(unresolved.expected,null);assert(unresolved.findings.some(f=>f.reason.includes('numeric specific: 0.01')));
 assert(annualQuantityComputation({...row,adValorem:'3.5',textRate:row.textRate.replace('6.3%','350%')},units,proof.fieldsSourceId));
});
test('quantity equations 1 through 6 calculate exactly with separately matched quantities',()=>{
 const samples:[string,string,string,string,string,[string,string],string][]=[['1','0','0.018','0','1.8 cents/kg',['KG',''],'1.80'],['2','0','0.02','0','2 cents/kg',['NO','KG'],'0.50'],['3','0','0.044','0.314','4.4 cents/liter + 31.4 cents/pf. liter',['L','PFL'],'12.25'],['4','0.025','0.16','0','16 cents each + 2.5%',['NO',''],'41.00'],['5','0.259','0.353','0','35.3 cents/kg + 25.9%',['NO','KG'],'267.83'],['6','0.063','0.019','0.135',row.textRate,['NO','KG'],'68.28']];
 for(const [rateType,adValorem,specific,other,textRate,quantityCodes,expected]of samples){const e={...entry,unit:quantityCodes[0],shipment:{quantity2:'25',unit2:quantityCodes[1]}},r=run(e,{...row,rateType,adValorem,specific,other,textRate,quantityCodes});assert.equal(r.expected,expected,JSON.stringify(r.findings));assert.equal(r.validation?.compiler,'historical-ordinary-quantity-v1');assert(r.components[0].quantityInputs?.length);}
});
test('missing, conflicting and component quantities cannot be replaced by a primary quantity',()=>{
 assert.equal(run().expected,'68.28');assert.equal(run({...entry,quantity:'25',unit:'KG',shipment:{quantity2:'100',unit2:'NO'}}).expected,'68.28');const missing=run({...entry,shipment:undefined});assert.equal(missing.expected,null);assert(missing.findings.some(f=>f.type==='missing_quantity'&&f.missing.includes('unit: kg')));
 const conflict=run({...entry,shipment:{quantity2:'50',unit2:'NO',quantity3:'25',unit3:'KG'}});assert.equal(conflict.expected,null);assert(conflict.findings.some(f=>f.type==='quantity_conflict'));assert(auditBlockers(conflict).shipment_data.some(f=>f.type==='quantity_conflict'));
 const component={...row,rateType:'2',adValorem:'0',specific:'0.178',other:'0',textRate:'17.8 cents/kg on molybdenum content',quantityCodes:['KG','CKG'] as [string,string]};assert.equal(run({...entry,unit:'KG',shipment:undefined},component).expected,null);assert.equal(run({...entry,unit:'KG',shipment:{quantity2:'10',unit2:'CKG'}},component).expected,'1.78');
});
test('reviewed quantity corrections preserve declarations and CSV calculation evidence',()=>{
 const decision:FactDecision={row:1,kind:'confirm_facts',note:'SYNTHETIC dated weight correction.',evidence:['SYNTHETIC-WEIGHT-DOC'],validFrom:'2014-01-01',validBefore:'2015-01-01',shipment:{quantity2:'20',unit2:'KG'}};
 const r=run(entry,row,[decision]);assert.equal(r.expected,'67.60');assert.equal(r.reference?.annual?.baseDutyScenario?.amount,'67.60');assert.equal(entry.shipment?.quantity2,'25');assert.equal(r.components[0].quantityInputs?.find(q=>q.unit==='kg')?.quantity,'20');
 const csv=exportAudit({batch:{id:'SYNTHETIC-QUANTITY'},rows:[{entry,result:r}],decisions:[decision],verified:true,resultRevision:1});assert(csv.includes('SYNTHETIC-FIELDS'));assert(csv.includes('quantityInputs'));assert(csv.includes('20'));assert(csv.includes(AUDIT_VERSION));
 for(const patch of [{shipment:{...entry.shipment,preference:'AU'}},{shipment:{...entry.shipment,entryType:'21'}},{chapter99:['9903.88.01']}])assert.equal(run({...entry,...patch}).expected,null);
});
test('quantity bases retain dated shared stacking decisions before calculating money',()=>{
 const ref=reference();ref.stackingRules=[{id:'SYNTHETIC-BASE-EXCLUSION',targetMeasure:'base',action:'exclude',capRatePercent:null,conditions:{},priority:100,citation:'https://www.usitc.gov/SYNTHETIC-STACKING',ruleText:'SYNTHETIC approved historical base exclusion for this test.',effectiveDate:'2014-01-01',expiresDate:'2015-01-01',precedenceOver:null,precedenceReason:null}];
 const r=evaluateAuditEntry({...entry,shipment:undefined},[],'SYNTHETIC-PRODUCT',[],false,null,ref,true);assert.equal(r.expected,'0.00');assert.equal(r.components[0].rate,'Free');assert(r.components[0].explanation.includes('SYNTHETIC-STACKING'));
 const expired={...ref,stackingRules:ref.stackingRules.map(s=>({...s,expiresDate:'2014-06-01'}))};assert.equal(evaluateAuditEntry(entry,[],'SYNTHETIC-PRODUCT',[],false,null,expired,true).expected,null,'An expired instruction never removes a quantity requirement.');
});
test('an exact excise-only note is excluded from customs duties; other footnotes still block',()=>{
 const excise='<spec>  Imports under this subheading may be subject to Federal Excise Tax (26 U.S.C. 5041).';assert.equal(run(entry,{...row,footnote:excise}).expected,'68.28');assert.equal(run(entry,{...row,footnote:excise+' Other customs duties apply.'}).expected,null);
});
test('sum arithmetic rounds only the complete result and withholds any missing term',()=>{
 const term=(raw:string,quantity:string|null,unit:string)=>({raw,input:{value:'1.00',quantity,unit}});
 assert.equal(computeExactDutySum([term('$0.0049/no','1','no'),term('$0.0049/kg','1','kg')]),'0.01');
 assert.equal(computeExactDutySum([term('$0.0049/no','1','no'),term('$0.0049/kg',null,'kg')]),null);assert.equal(computeExactDutySum([term('5% if eligible',null,'')]),null);assert.equal(computeExactDutySum([]),null);
});
