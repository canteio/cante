import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{parseCashDeposit,historicalDeposits,type AdcvdReference}from'../app/api/tariff/references/adcvd-history';import type{AdcvdHeader}from'../app/api/tariff/references/adcvd-source';
// Public instruction excerpts exercise the grammar. Fake IDs/facts below are
// explicitly functionality tests, not source attestation or legal qualification.
const older=readFileSync('scripts/test-fixtures/historical-audits/adcvd-2025-public-excerpt.txt','utf8'),newer=readFileSync('scripts/test-fixtures/historical-audits/adcvd-2026-public-excerpt.txt','utf8');
const header={imn:'SYNTHETIC',messageNumber:'5171401',caseNumberList:['A570909'],messageDate:'06/20/2025',effectiveDate:'06/16/2025',type:'CD-Cash Deposit',statusDesc:'Active',statusCode:'AC',accessType:'Public',correctionMessage:false,originalImn:'',inactiveDate:'',frCite:'90 FR 25220',frDate:'06/16/2025',messageTitle:'Public cash deposit instruction'} as AdcvdHeader;
const recent={...header,messageNumber:'6146406',messageDate:'05/26/2026',effectiveDate:'05/19/2026'},ref:AdcvdReference={caseNumber:'A570909',indexSourceId:'SYNTHETIC-INDEX',issues:[],messages:[{header,headerSourceId:'SYNTHETIC-H1',bodySourceId:'SYNTHETIC-B1',text:older},{header:recent,headerSourceId:'SYNTHETIC-H2',bodySourceId:'SYNTHETIC-B2',text:newer}]},facts={adcvd_scope_verified:true,adcvd_party_verified:true,adcvd_instructions_clear:true,adcvd_cases_complete:true},input={date:'2025-07-01',origin:'CN',shipment:{cases:['A-570-909-205'],exporter:'Shanghai Yueda Nails Co., Ltd.',dutyStage:'cash_deposit' as const},facts};
test('published company-specific instructions preserve effective dates, aliases, whitespace and replaced cases',()=>{
 const a=parseCashDeposit(header,older),b=parseCashDeposit(recent,newer);assert(a);assert(b);assert.equal(a.from,'2025-06-16');assert.equal(a.rates[0].rate,'11.73%');assert.equal(b.rates[0].rate,'28.28%');assert(b.rates[0].exporters.includes('Shanghai Yueda Nails Co., Ltd.'));assert(b.deactivatedCases.includes('A-570-909-205'));assert(a.deactivatedCases.includes('A-570-909-202'));assert.equal(historicalDeposits([ref],input).measures[0]?.rate,'11.73%');
});
test('a deactivated company case cannot carry an old low rate into later years',()=>{
 const r=historicalDeposits([ref],{...input,date:'2026-08-15'});assert.equal(r.measures.length,0);assert(r.issues.some(i=>i.includes('deactivates')));const replaced=historicalDeposits([ref],{...input,date:'2026-08-15',shipment:{...input.shipment,cases:['A-570-909-229']}});assert.equal(replaced.measures[0]?.rate,'28.28%');assert.equal(replaced.issues.length,0);
});
test('no missing scope, party, payment stage or case qualification becomes a guessed deposit',()=>{
 for(const broken of [{...input,facts:{}},{...input,origin:'VN'},{...input,shipment:{...input.shipment,dutyStage:'final_assessment' as const}},{...input,shipment:{...input.shipment,exporter:'SIMILAR SUPPLIER'}},{...input,shipment:{...input.shipment,cases:['A-570-909']}},{...input,date:'2025-06-15'}])assert.equal(historicalDeposits([ref],broken).measures.length,0);
 assert.equal(historicalDeposits([] ,input).measures.length,0);assert.equal(parseCashDeposit({...header,correctionMessage:true},older),null);assert.equal(parseCashDeposit(header,older.replace('06/16/2025, (the date','06/17/2025, (the date')),null);assert.equal(parseCashDeposit(header,older.replace('Cash deposit rate: 11.73%','Cash deposit rate: $11.73 per kg')),null);
});
test('later unparsed instructions block carry-forward instead of disappearing from the calculation',()=>{
 const changed={...recent,effectiveDate:'07/01/2025'},unsupported={...ref,messages:[ref.messages[0],{...ref.messages[1],header:changed,text:'Unknown instruction grammar'}]};assert.equal(historicalDeposits([unsupported],{...input,date:'2025-08-01'}).measures.length,0);const incomplete={...ref,issues:['Missing retained instruction original']};assert.equal(historicalDeposits([incomplete],input).measures.length,0);
});

const mx=JSON.parse(readFileSync('scripts/test-fixtures/historical-audits/adcvd-mexico-public.json','utf8')).messages as {header:AdcvdHeader;text:string}[];
const mexico:AdcvdReference={caseNumber:'A201844',indexSourceId:'SYNTHETIC-MX-INDEX',issues:[],messages:mx.map((m,i)=>({...m,headerSourceId:'SYNTHETIC-MX-H'+i,bodySourceId:'SYNTHETIC-MX-B'+i}))};
test('actual Mexico instructions establish named parties, separate operative dates and the amended rate',()=>{
 const parsed=mx.map(m=>parseCashDeposit(m.header,m.text));assert(parsed.every(Boolean));assert.deepEqual(parsed.map(p=>p!.from),['2024-05-10','2025-09-04','2026-02-20']);assert(parsed.every(p=>p!.origin==='MX'));assert.equal(parsed[0]!.rates.length,5);assert.equal(parsed[1]!.rates.length,2);assert.equal(parsed[2]!.rates[0].rate,'36.34%');assert(parsed[1]!.unchangedOtherRates);
 for(const[i,date,expected]of[[0,'2024-06-15','1.16%'],[1,'2025-09-04','32.05%'],[2,'2026-02-20','36.34%']] as const){const r=historicalDeposits([mexico],{date,origin:'MX',shipment:{cases:['A-201-844-001'],exporter:parsed[i]!.rates[0].exporters[0],dutyStage:'cash_deposit'},facts});assert.equal(r.measures[0]?.rate,expected,JSON.stringify(r.issues));assert.equal(r.issues.length,0);}
});
test('an explicit named exporter continuation survives a later review, while unproved amendment carry-forward remains open',()=>{
 const shipment={cases:['A-201-844-017'],exporter:'Gerdau Corsa S.A.P.I. de C.V.',dutyStage:'cash_deposit' as const};assert.equal(historicalDeposits([mexico],{date:'2025-10-01',origin:'MX',shipment,facts}).measures[0]?.rate,'2.11%');assert.equal(historicalDeposits([mexico],{date:'2026-03-01',origin:'MX',shipment,facts}).measures.length,0);
 const before=historicalDeposits([mexico],{date:'2026-02-19',origin:'MX',shipment:{cases:['A-201-844-001'],exporter:'Deacero S.A.P.I. de C.V.',dutyStage:'cash_deposit'},facts});assert.equal(before.measures[0]?.rate,'32.05%','Today’s amended rate is not applied before its operative date.');
});
test('source origin, complete named rows and explicit effective dates cannot be replaced by shipment declarations',()=>{
 const m=mx[1];for(const text of[m.text.replace('Case number: A-201-844-009','Case number: A-201-844-001'),m.text.replace('Cash deposit rate:  22.27%','Cash deposit rate:  $22.27/kg'),m.text.replace('09/04/2025, the required','09/05/2025, the required'),m.text+'\nExporter: Unknown\nCase number: A-201-844-099\nConditional rate: 2%'])assert.equal(parseCashDeposit(m.header,text),null);
 assert.equal(parseCashDeposit({...m.header,messageTitle:m.header.messageTitle.replace('Mexico','Vietnam')},m.text),null);
 assert.equal(historicalDeposits([mexico],{...input,origin:'CN',date:'2025-10-01',shipment:{...input.shipment,cases:['A-201-844-001'],exporter:'Deacero S.A.P.I. de C.V.'}}).measures.length,0);
 const sameDate={...mexico,messages:[mexico.messages[1],{...mexico.messages[1],header:{...mexico.messages[1].header,imn:'SYNTHETIC-OTHER',messageNumber:'9999999'}}]};assert.equal(historicalDeposits([sameDate],{...input,origin:'MX',date:'2025-10-01',shipment:{...input.shipment,cases:['A-201-844-001'],exporter:'Deacero S.A.P.I. de C.V.'}}).measures.length,0);
});

test('same-date instructions for distinct company cases do not conflict; a carried rate cites its intervening instruction chain',()=>{
 const original=mx[1],row1='Producer and/or Exporter:  Deacero S.A.P.I. de C.V.; I.N.G.E.T.E.K.N.O.S. Estructurales S.A.\nCase number: A-201-844-001\nCash deposit rate:  32.05%',row2='Producer and/or Exporter:  TA 2000 S.A. de C.V.\nCase number: A-201-844-009\nCash deposit rate:  22.27%',parts=[original.text.replace(row2,''),original.text.replace(row1,'')];assert(parts.every(t=>parseCashDeposit(original.header,t)?.rates.length===1));
 const separate={...mexico,messages:parts.map((text,i)=>({header:{...original.header,imn:'SYNTHETIC-'+i,messageNumber:'SYNTHETIC-'+i},text,headerSourceId:'SYNTHETIC-H'+i,bodySourceId:'SYNTHETIC-B'+i}))};const r=historicalDeposits([separate],{date:'2025-10-01',origin:'MX',shipment:{cases:['A-201-844-001'],exporter:'Deacero S.A.P.I. de C.V.',dutyStage:'cash_deposit'},facts});assert.equal(r.measures[0]?.rate,'32.05%');assert.equal(r.measures[0]?.sourceIds.length,5);
 const carried=historicalDeposits([mexico],{date:'2025-10-01',origin:'MX',shipment:{cases:['A-201-844-017'],exporter:'Gerdau Corsa S.A.P.I. de C.V.',dutyStage:'cash_deposit'},facts});assert.deepEqual(new Set(carried.measures[0].sourceIds),new Set(['SYNTHETIC-MX-INDEX','SYNTHETIC-MX-H1','SYNTHETIC-MX-B1','SYNTHETIC-MX-H0','SYNTHETIC-MX-B0']));
});

test('deposit coverage is entry-specific and distinct from the actual operative date',()=>{
 const r=historicalDeposits([mexico],{date:'2025-10-01',origin:'MX',shipment:{cases:['A-201-844-001'],exporter:'Deacero S.A.P.I. de C.V.',dutyStage:'cash_deposit'},facts}),m=r.measures[0];assert(m);assert.equal(m.legalEffectiveOn,'2025-09-04');assert.equal(m.coverageFrom,'2025-10-01');assert.equal(m.coverageBefore,'2025-10-02');assert.equal(m.messageNumber,'5251402');assert.equal(historicalDeposits([mexico],{...input,date:'2025-02-30'}).measures.length,0);
});

const ca=JSON.parse(readFileSync('scripts/test-fixtures/historical-audits/adcvd-canada-public.json','utf8')).messages as {header:AdcvdHeader;text:string}[];
const canada=(root:string):AdcvdReference=>({caseNumber:root,indexSourceId:'SYNTHETIC-CA-INDEX',issues:[],messages:ca.filter(m=>m.header.caseNumberList.includes(root)).map((m,i)=>({...m,headerSourceId:'SYNTHETIC-CA-H'+i,bodySourceId:'SYNTHETIC-CA-B'+i}))});
const caInput={date:'2025-10-01',origin:'CA',shipment:{cases:['A-122-857-001'],exporter:'Canfor Corporation',dutyStage:'cash_deposit' as const},facts};
test('complete Canada tables retain all named rows, wrapped names and conditional producer/exporter pairs',()=>{
 const p=ca.map(m=>parseCashDeposit(m.header,m.text));assert(p.every(Boolean));assert.deepEqual(p.map(x=>x!.rates.length),[243,243,261,260,223,245,217]);assert(p.every(x=>x!.origin==='CA'));
 const cv=p.find(x=>x!.from==='2025-08-12')!;const pair=cv!.rates.find(r=>r.caseNumber==='C-122-858-357')!;assert(pair.producers?.includes('Fontaine Inc.'));assert(pair.excludeExporters);assert.equal(pair.rate,'14.63%');
 assert(cv!.rates[0].exporters.includes('Canfor Wood Products Marketing, Ltd.'));
});
test('dated explicit amendments replace only their referenced same-date original and keep the citation chain',()=>{
 for(const[date,rate,msg]of[['2024-08-19','10.44%','4271405'],['2025-07-29','35.47%','5265401'],['2026-10-19','17.00%','6300406']]){
  const r=historicalDeposits([canada('A122857')],{...caInput,date});assert.equal(r.issues.length,0,JSON.stringify(r.issues));assert.equal(r.measures[0]?.rate,rate);assert.equal(r.measures[0]?.messageNumber,msg);
 }
 const changed=canada('A122857');changed.messages=changed.messages.map(m=>({...m,text:m.text.replace('5218401, dated 08/06/2025','5218401, dated 08/07/2025')}));
 assert.equal(historicalDeposits([changed],caInput).measures.length,0);
});
test('Canadian CVD uses the exact company row and explicit producer/exporter conditions',()=>{
 const ref=canada('C122858'),r=historicalDeposits([ref],{...caInput,shipment:{...caInput.shipment,cases:['C-122-858-001']}});assert.equal(r.measures[0]?.rate,'12.12%');assert.equal(r.issues.length,0);
 const paired={...caInput,shipment:{...caInput.shipment,cases:['C-122-858-357'],exporter:'FICTIONAL REVIEWED OTHER EXPORTER',manufacturer:'Fontaine Inc.'}};
 assert.equal(historicalDeposits([ref],paired).measures[0]?.rate,'14.63%');
 for(const shipment of [{...paired.shipment,manufacturer:undefined},{...paired.shipment,manufacturer:'unknown'},{...paired.shipment,manufacturer:'Other producer'},{...paired.shipment,exporter:'Fontaine Inc.'}])assert.equal(historicalDeposits([ref],{...paired,shipment}).measures.length,0);
 const reverse={...paired,shipment:{...paired.shipment,cases:['C-122-858-358'],exporter:'Fontaine Inc.',manufacturer:'FICTIONAL REVIEWED OTHER PRODUCER'}};
 assert.equal(historicalDeposits([ref],reverse).measures[0]?.rate,'14.63%');
 assert.equal(historicalDeposits([ref],{...reverse,shipment:{...reverse.shipment,manufacturer:'Fontaine Inc.'}}).measures.length,0);
});
test('Canada table corruption, partial rows, wrong dates and inactive cases do not become estimates',()=>{
 const m=ca.find(m=>m.header.messageNumber==='5226403')!;
 for(const text of [m.text.replace('Cash deposit rate:  12.12%','Cash deposit rate:  $12.12/kg'),m.text.replace('Case number:  C-122-858-001','Case number:  C-122-858-002'),m.text.replace('08/12/2025 produced','08/13/2025 produced'),m.text+'\nProducer: Unknown\nExporter: Unknown\nCase number: C-122-858-999\nConditional rate: 1%'])assert.equal(parseCashDeposit(m.header,text),null);
 const inactive=historicalDeposits([canada('A122857')],{...caInput,shipment:{...caInput.shipment,cases:['A-122-857-349'],exporter:'FICTIONAL'}});assert.equal(inactive.measures.length,0);assert(inactive.issues.some(i=>i.includes('deactivates')));
});
