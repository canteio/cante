import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import{auditTable,suggestMapping,parseAudit,validateMapping}from'../app/api/audits/input';
import{defaultOptions,factDecisionSchema,type RuleBundle,type FactDecision}from'../app/api/audits/model';
import{shipmentFields,atEasternCutoff,shipmentQuantity}from'../app/api/audits/shipment';import{evaluateAuditEntry}from'../app/api/audits/engine';
const csv=readFileSync('scripts/test-fixtures/historical-audits/entries.csv','utf8'),options={...defaultOptions,currencyUsd:true,dutiesOnly:true,ordinaryConsumption:true},entries=parseAudit(csv,suggestMapping(auditTable(csv).headers),options);
function fixture(){const rule=JSON.parse(readFileSync('scripts/test-fixtures/historical-audits/rules.json','utf8')) as RuleBundle;rule.definition.measures=[{...rule.definition.measures[0],id:'base',rate:'4%',conditions:{}}];rule.definition.stacking=[];const entry={...entries[0],value:'1000.00',paid:'140.00',shipment:{steelValue:'200.00'}};return{rule,entry};}
const decision:FactDecision={row:1,kind:'confirm_facts',note:'SYNTHETIC dated content-value evidence decision',evidence:['SYNTHETIC-DOCUMENT'],validFrom:'2024-01-01',validBefore:'2025-01-01',facts:{content_values_verified:true}};
test('equivalent litre spellings preserve original input and detect conflicting quantities without conversion',()=>{
 const{rule,entry}=fixture();rule.definition.measures[0].rate='$0.33/l';
 for(const unit of ['l','L','liter','liters','litre','litres']){const input={...entry,quantity:'100',unit},r=evaluateAuditEntry(input,[rule],'SYNTHETIC',[],true);assert.equal(r.expected,'33.00');assert.equal(input.unit,unit);assert.equal(r.components[0].unit,'l');}
 for(const unit of ['LT','ml','proof liters','kg'])assert.equal(evaluateAuditEntry({...entry,quantity:'100',unit},[rule],'SYNTHETIC',[],true).expected,null);
 const conflict={...entry,quantity:'100',unit:'liter',shipment:{quantity2:'101',unit2:'L'}};assert(shipmentQuantity(conflict,'$0.33/l').conflict);assert.equal(evaluateAuditEntry(conflict,[rule],'SYNTHETIC',[],true).expected,null);
 rule.definition.measures[0].rate='$0.33/liter';assert.equal(evaluateAuditEntry({...entry,quantity:'100',unit:'L'},[rule],'SYNTHETIC',[],true).expected,'33.00');
});
test('legacy mappings remain accepted; additional shipment fields never borrow a different source column',()=>{
 const headers=auditTable(csv).headers,mapping=suggestMapping(headers),legacy=Object.fromEntries(Object.entries(mapping).filter(([k])=>!(k in shipmentFields))),normalized=validateMapping(headers,legacy);assert.equal(normalized.steelValue,null);assert.equal(normalized.hts,mapping.hts);assert.throws(()=>validateMapping(headers,{...mapping,steelValue:mapping.value}),/two different/);
});
test('CSV preserves metal values, party identities, cases, quantities and original raw fields without confirming them',()=>{
 const input='entry_number,entry_line,entry_date,sku,hts_code,country_of_origin,customs_value_usd,total_duties_paid,steel_content_value,manufacturer_id,exporter_id,adcvd_cases,quantity_2,unit_2,entry_timestamp\nSYNTHETIC,1,2025-08-07,SYNTHETIC,8501314000,CN,1000,100,200,MFR-1,EXP-2,A-570-001;C-570-002,10,kg,2025-08-07T01:00:00-04:00\n',row=parseAudit(input,suggestMapping(auditTable(input).headers),options)[0];assert.deepEqual(row.errors,[]);assert.equal(row.shipment?.steelValue,'200.00');assert.deepEqual(row.shipment?.cases,['A-570-001','C-570-002']);assert.equal(row.shipment?.quantity2,'10');assert.equal(row.raw.steel_content_value,'200');assert(!('content_values_verified'in row));
});
test('content-based duties require evidence and assess only the confirmed basis; dated corrections preserve declarations',()=>{
 const{rule,entry}=fixture();rule.definition.measures.push({...rule.definition.measures[0],id:'steel',type:'section232',rate:'50%',basis:'steel_content'});assert.equal(evaluateAuditEntry(entry,[rule],'SYNTHETIC',[],true).expected,null);
 const r=evaluateAuditEntry(entry,[rule],'SYNTHETIC',[decision],true);assert.equal(r.expected,'140.00');assert.equal(r.components[1].assessedValue,'200.00');assert.equal(r.components[1].amount,'100.00');
 const corrected=evaluateAuditEntry(entry,[rule],'SYNTHETIC',[{...decision,shipment:{steelValue:'100.00'}}],true);assert.equal(corrected.expected,'90.00');assert.equal(entry.shipment.steelValue,'200.00');
 for(const change of [{...decision,evidence:[]},{...decision,validFrom:'2025-01-01'},{...decision,facts:{content_values_verified:false}}])assert.equal(evaluateAuditEntry(entry,[rule],'SYNTHETIC',[change],true).expected,null);
 assert.equal(evaluateAuditEntry(entry,[rule],'SYNTHETIC',[{...decision,shipment:{steelValue:'1000.01'}}],true).expected,null);
});
test('explicit non-metal and non-US bases use exact subtraction without inventing missing zero values',()=>{
 const{rule,entry}=fixture();rule.definition.measures.push({...rule.definition.measures[0],id:'remainder',type:'chapter99',rate:'10%',basis:'non_metal_content'});
 assert.equal(evaluateAuditEntry(entry,[rule],'SYNTHETIC',[decision],true).expected,null);const shipment={steelValue:'200.00',aluminumValue:'100.00',copperValue:'0.00',usValue:'250.00'};assert.equal(evaluateAuditEntry({...entry,shipment},[rule],'SYNTHETIC',[decision],true).expected,'110.00');rule.definition.measures[1].basis='non_us_content';assert.equal(evaluateAuditEntry({...entry,shipment},[rule],'SYNTHETIC',[decision],true).expected,'115.00');
});
test('specific/compound rates choose a matching second quantity and reject contradictory matching quantities',()=>{
 const{rule,entry}=fixture();rule.definition.measures[0].rate='2.5 cents/kg + 4%';const row={...entry,quantity:'3',unit:'No',shipment:{quantity2:'10',unit2:'kg'}};const r=evaluateAuditEntry(row,[rule],'SYNTHETIC',[],true);assert.equal(r.expected,'40.25');assert.equal(r.components[0].quantity,'10');assert.equal(evaluateAuditEntry({...row,quantity:'11',unit:'kg'},[rule],'SYNTHETIC',[],true).expected,null);assert.equal(evaluateAuditEntry({...row,quantity:'10.0',unit:'kg'},[rule],'SYNTHETIC',[],true).expected,'40.25');
});
test('reviewed timestamp corrections cannot move the legal date; malformed input never supplies shipment facts',()=>{
 const{rule,entry}=fixture();const r=evaluateAuditEntry(entry,[rule],'SYNTHETIC',[{...decision,shipment:{entryTimestamp:'2024-02-01T00:00:00Z'}}],true);assert.equal(r.expected,null);assert(r.findings.some(f=>f.type==='entry_time'));assert(!factDecisionSchema.safeParse({...decision,shipment:{steelValue:'-1.00'}}).success);assert(!factDecisionSchema.safeParse({...decision,shipment:{entryTimestamp:'2024-01-01T12:00:00'}}).success);
});

test('declared preference, case and special-entry inputs cannot inherit an ordinary calculation',()=>{
 const{rule,entry}=fixture();assert.equal(evaluateAuditEntry({...entry,shipment:{preference:'S'}},[rule],'SYNTHETIC',[],true).expected,null);assert.equal(evaluateAuditEntry({...entry,shipment:{cases:['A-570-001']}},[rule],'SYNTHETIC',[],true).expected,null);assert.equal(evaluateAuditEntry({...entry,shipment:{entryType:'21'}},[rule],'SYNTHETIC',[],true).expected,null);
 rule.definition.coverage=rule.definition.coverage.map(c=>({...c,entryTypes:['21']}));assert.equal(evaluateAuditEntry({...entry,shipment:{entryType:'21'}},[rule],'SYNTHETIC',[],true).expected,'40.00');
});

test('content credit caps retain fractional cents until final duty rounding',()=>{
 const{rule,entry}=fixture();rule.definition.measures.push({...rule.definition.measures[0],id:'capped',type:'section232',rate:'50%',basis:'non_us_content_capped40'});const result=evaluateAuditEntry({...entry,value:'1.01',paid:'0.34',shipment:{usValue:'0.50'}},[rule],'SYNTHETIC',[decision],true);assert.equal(result.expected,'0.34');assert.equal(result.components[1].assessedValue,'0.6060');assert.equal(result.components[1].amount,'0.30');
 assert(!factDecisionSchema.safeParse({...decision,shipment:{entryTimestamp:'2026-01-01T12:00:00+99:99'}}).success);
});

test('one entry value cannot be charged two company rates under the same AD/CVD order',()=>{
 assert(!factDecisionSchema.safeParse({...decision,shipment:{cases:['A-570-001-123','A-570-001-456']}}).success);assert(factDecisionSchema.safeParse({...decision,shipment:{cases:['A-570-001-123','C-570-001-456']}}).success);
});

test('legal Eastern cutoffs compare actual instants, including daylight saving and seconds',()=>{
 assert.equal(atEasternCutoff('2025-03-04T05:00:59Z','2025-03-04','00:01'),false);
 assert.equal(atEasternCutoff('2025-03-04T05:01:00Z','2025-03-04','00:01'),true);
 assert.equal(atEasternCutoff('2025-08-07T04:00:59.999Z','2025-08-07','00:01'),false);
 assert.equal(atEasternCutoff('2025-08-07T04:01:00Z','2025-08-07','00:01'),true);
 assert.equal(atEasternCutoff('2026-02-24T05:00:00Z','2026-02-24','00:00'),true);
 for(const timestamp of [undefined,'2025-08-07T00:01:00Z','2025-08-07T00:01:00','not a date'])assert.equal(atEasternCutoff(timestamp,'2025-08-07','00:01'),null);
});


test('remainder duties exclude only specified dutiable metal; unrelated content stays assessed',()=>{
 const{rule,entry}=fixture();rule.definition.measures.push({...rule.definition.measures[0],id:'steel',type:'section232',rate:'50%',basis:'steel_content'},{...rule.definition.measures[0],id:'surcharge',type:'chapter99',rate:'10%',basis:'non_steel_content'});
 const shipment={steelValue:'200.00',aluminumValue:'100.00',copperValue:'50.00'},r=evaluateAuditEntry({...entry,shipment},[rule],'SYNTHETIC',[decision],true);assert.equal(r.expected,'220.00');assert.equal(r.components[2].assessedValue,'800.00');assert.equal(evaluateAuditEntry({...entry,shipment:{steelValue:'800.00',aluminumValue:'200.00',copperValue:'100.00'}},[rule],'SYNTHETIC',[decision],true).expected,null);
 assert.equal(evaluateAuditEntry(entry,[rule],'SYNTHETIC',[decision],true).expected,'220.00','Missing unrelated metal fields are not invented or deducted.');
 rule.definition.measures[2].basis='non_steel_aluminum_content';const both=evaluateAuditEntry({...entry,shipment},[rule],'SYNTHETIC',[decision],true);assert.equal(both.expected,'210.00');assert.equal(both.components[2].assessedValue,'700.00');assert.equal(evaluateAuditEntry(entry,[rule],'SYNTHETIC',[decision],true).expected,null);
 rule.definition.measures[2].basis='non_aluminum_copper_content';assert.equal(evaluateAuditEntry({...entry,shipment},[rule],'SYNTHETIC',[decision],true).components[2].assessedValue,'850.00');
 rule.definition.measures[2].basis='non_steel_copper_content';assert.equal(evaluateAuditEntry({...entry,shipment},[rule],'SYNTHETIC',[decision],true).components[2].assessedValue,'750.00');
 rule.definition.measures[2].basis='non_aluminum_content';assert.equal(evaluateAuditEntry({...entry,shipment},[rule],'SYNTHETIC',[decision],true).components[2].assessedValue,'900.00');
 rule.definition.measures[2].basis='non_copper_content';assert.equal(evaluateAuditEntry({...entry,shipment},[rule],'SYNTHETIC',[decision],true).components[2].assessedValue,'950.00');
});

test('dated primary quantity corrections use the same exact path for reviewed bundles and preserve original counts',()=>{
 const{rule,entry}=fixture();rule.definition.measures[0].rate='$0.10/no';const original={...entry,quantity:'20',unit:'NO'},corrected={...decision,shipment:{primaryQuantity:'10',primaryUnit:'NO'}};
 const before=evaluateAuditEntry(original,[rule],'SYNTHETIC',[],true),after=evaluateAuditEntry(original,[rule],'SYNTHETIC',[corrected],true);assert.equal(before.expected,'2.00');assert.equal(after.expected,'1.00');assert.equal(original.quantity,'20');
 assert.equal(evaluateAuditEntry({...original,shipment:{quantity2:'20',unit2:'NO'}},[rule],'SYNTHETIC',[corrected],true).expected,null);
});

test('changing AD/CVD identities or payment stage requires renewed case, party and instruction evidence',()=>{
 const{rule,entry}=fixture(),required=['adcvd_party_verified','adcvd_instructions_clear','adcvd_cases_complete'] as const;for(const coverage of rule.definition.coverage)coverage.requiredFacts=[...required];rule.definition.measures.push({...rule.definition.measures[0],id:'A-570-001-001',type:'adcvd',rate:'1%',conditions:{duty_stage:'cash_deposit'}});
 const original={...entry,shipment:{cases:['A-570-001-001'],exporter:'SYNTHETIC ORIGINAL EXPORTER',dutyStage:'cash_deposit' as const}},confirmed:FactDecision={...decision,facts:{adcvd_party_verified:true,adcvd_instructions_clear:true,adcvd_cases_complete:true}},changed:FactDecision={...decision,facts:{},shipment:{exporter:'SYNTHETIC DIFFERENT EXPORTER'}};
 assert.equal(evaluateAuditEntry(original,[rule],'SYNTHETIC',[confirmed],true).expected,'50.00');const r=evaluateAuditEntry(original,[rule],'SYNTHETIC',[confirmed,changed],true);assert.equal(r.expected,null);assert(r.findings.some(f=>f.missing.includes('adcvd_party_verified')));
 assert.equal(evaluateAuditEntry(original,[rule],'SYNTHETIC',[confirmed,{...changed,facts:confirmed.facts}],true).expected,'50.00');assert.equal(evaluateAuditEntry(original,[rule],'SYNTHETIC',[confirmed,{...changed,shipment:{exporter:original.shipment.exporter}}],true).expected,'50.00');assert.equal(original.shipment.exporter,'SYNTHETIC ORIGINAL EXPORTER');
});

test('product, origin and order-root corrections cannot inherit AD scope evidence; explicit renewed facts restore the calculation',()=>{
 const{rule,entry}=fixture(),oldCase='A-570-001-001',newCase='A-570-002-001',required=['adcvd_scope_verified','adcvd_party_verified','adcvd_instructions_clear','adcvd_cases_complete'] as const,renewed={adcvd_scope_verified:true,adcvd_party_verified:true,adcvd_instructions_clear:true,adcvd_cases_complete:true};
 for(const c of rule.definition.coverage){c.requiredFacts=[...required];c.hts.push('8501316000');c.origins.push('MX');}for(const m of rule.definition.measures){m.hts=['8501314000','8501316000'];m.origins=['CN','MX'];}for(const id of[oldCase,newCase])rule.definition.measures.push({...rule.definition.measures[0],id,type:'adcvd',rate:'1%',conditions:{duty_stage:'cash_deposit',adcvd_cases:id}});
 const original={...entry,hts:'8501314000',origin:'CN',shipment:{cases:[oldCase],exporter:'SYNTHETIC EXPORTER',dutyStage:'cash_deposit' as const}},confirmed:FactDecision={...decision,facts:renewed};
 assert.equal(evaluateAuditEntry(original,[rule],'SYNTHETIC',[confirmed],true).expected,'50.00');
 for(const changed of[{...decision,hts:'8501316000',facts:{classification_verified:true}},{...decision,origin:'MX',facts:{origin_verified:true}},{...decision,shipment:{cases:[newCase]},facts:{adcvd_party_verified:true,adcvd_instructions_clear:true,adcvd_cases_complete:true}}] as FactDecision[]){const r=evaluateAuditEntry(original,[rule],'SYNTHETIC',[confirmed,changed],true);assert.equal(r.expected,null);assert.notEqual(r.factsUsed.adcvd_scope_verified,true);assert(r.findings.some(f=>f.missing.includes('adcvd_scope_verified')));assert.equal(evaluateAuditEntry(original,[rule],'SYNTHETIC',[confirmed,{...changed,facts:{...changed.facts,...renewed}}],true).expected,'50.00');}
 const same={...decision,hts:original.hts,origin:original.origin,facts:{classification_verified:true,origin_verified:true}};assert.equal(evaluateAuditEntry(original,[rule],'SYNTHETIC',[confirmed,same],true).expected,'50.00');assert.equal(original.hts,'8501314000');assert.equal(original.origin,'CN');
});
test('removing declared cases requires explicit evidence that no AD/CVD applies; the original scope checkbox cannot supply that conclusion',()=>{
 const{rule,entry}=fixture();for(const c of rule.definition.coverage)c.requiredFacts=['adcvd_clear'];const original={...entry,shipment:{cases:['A-570-001-001'],dutyStage:'cash_deposit' as const}},removed:FactDecision={...decision,shipment:{cases:[]},facts:{}};
 const open=evaluateAuditEntry(original,[rule],'SYNTHETIC',[removed],true,null,undefined,true);assert.equal(open.expected,null);assert(open.findings.some(f=>f.missing.includes('adcvd_clear')));assert.equal(evaluateAuditEntry(original,[rule],'SYNTHETIC',[{...removed,facts:{adcvd_clear:true}}],true,null,undefined,true).expected,'40.00');assert.deepEqual(original.shipment.cases,['A-570-001-001']);
});
