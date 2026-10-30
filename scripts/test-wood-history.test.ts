import{chapter99NonApplicability}from'../app/api/tariff/references/chapter99-contract';
import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';
import{woodNote37,historicalWood,resolveHistoricalWood}from'../app/api/tariff/references/wood-history';
const dir='scripts/test-fixtures/historical-audits/',contexts=JSON.parse(readFileSync(dir+'wood-note37-public.json','utf8')),originals=JSON.parse(readFileSync(dir+'wood-supporting-public.json','utf8')),guidance=originals.filter((s:any)=>s.metadata.csms).map((s:any)=>({id:s.id,number:s.metadata.csms,text:s.text})),actions=originals.filter((s:any)=>s.metadata.documentNumber).map((s:any)=>({id:s.id,documentNumber:s.metadata.documentNumber,text:s.text}));
const facts={wood_scope_verified:true,wood_auto_overlap_clear:true};
const scope=(i:number,hts='4407110001',origin='CA',date=['2025-10-15','2026-01-15','2026-03-01','2026-08-01'][i],patch:Record<string,unknown>={})=>historicalWood({hts,origin,date,from:contexts[i].release.available_from,before:contexts[i].release.available_until,notes:contexts[i].note37,noteId:contexts[i].sourceId,rows:contexts[i].rows,guidance,actions,...patch})!;
test('complete dated Note37 contracts retain all exact code lists and reject altered legal text',()=>{
 for(const c of contexts){const p=woodNote37(c.note37);assert(p);assert.equal(p.timber.length,15);assert.equal(p.furniture.length,4);assert.equal(p.cabinet.length,3);assert.equal(woodNote37(c.note37.replace('All antidumping','Some antidumping')),null);}
});
test('published timber, furniture, cabinet and country rows use their actual rates and combined-base treatment',()=>{
 for(const [hts,origin,heading,rate,combined]of [['4407110001','CA','9903.76.01','10%',false],['9401614011','CN','9903.76.02','25%',false],['9403409060','CA','9903.76.03','25%',false],['9401614011','GB','9903.76.20','10%',false],['9401614011','JP','9903.76.21','15%',true],['9401614011','DE','9903.76.22','15%',true],['9401614011','KR','9903.76.23','15%',true]]as const){
  const s=scope(1,hts,origin),r=resolveHistoricalWood(s,{hts,date:'2026-01-15',origin,facts:{...facts,wood_cabinet_use:true}});assert.deepEqual(r.issues,[],JSON.stringify(s.issues));assert.equal(r.measures[0]?.id,heading);assert.equal(r.measures[0]?.rate,rate);assert.equal(r.replacesBase,combined);
 }
});
test('2026 does not inherit the original scheduled30/50 percent increases; the postponement original is required',()=>{
 for(const hts of ['9401614011','9403409060']){const s=scope(1,hts,'CA');assert.deepEqual(s.issues,[]);const missing=scope(1,hts,'CA',undefined,{actions:actions.filter((a:any)=>a.documentNumber!=='2026-00327')});assert(missing.issues.some(i=>i.includes('postponement')));const changed=scope(1,hts,'CA',undefined,{rows:contexts[1].rows.map((r:any)=>r.hts==='99037603'?{...r,general:r.general.replace('25%','50%')}:r)});if(hts==='9403409060')assert(resolveHistoricalWood(changed,{hts,date:'2026-01-15',origin:'CA',facts:{...facts,wood_cabinet_use:true}}).issues.length);}
});
test('Taiwan15 percent needs its dated original and instructions, without changing the original ordinary base',()=>{
 const s=scope(3,'9401614011','TW'),r=resolveHistoricalWood(s,{hts:s.hts,date:'2026-08-01',origin:'TW',facts});assert.deepEqual(r.issues,[]);assert.equal(r.measures[0]?.id,'9903.76.24');assert.equal(r.measures[0]?.rate,'15%');assert(r.replacesBase);
 const missing=scope(3,'9401614011','TW',undefined,{actions:actions.filter((a:any)=>a.documentNumber!=='2026-10571')});assert(missing.issues.length);
});
test('product use, auto overlap and exact initial Eastern cutoff stay explicit',()=>{
 const s=scope(0,'9403409060','CA');for(const f of [{},facts,{...facts,wood_cabinet_use:true,wood_auto_overlap_clear:false}])assert(resolveHistoricalWood(s,{hts:s.hts,date:'2025-10-15',origin:'CA',facts:f}).issues.length);
 const free=resolveHistoricalWood(s,{hts:s.hts,date:'2025-10-15',origin:'CA',facts:{...facts,wood_cabinet_use:false}});assert.equal(free.measures[0]?.id,'9903.76.04');assert.equal(free.active,false);assert(free.nonApplicable.length);
 const timber=scope(0);for(const entryTimestamp of [undefined])assert(resolveHistoricalWood(timber,{hts:timber.hts,date:'2025-10-14',origin:'CA',facts,shipment:{entryTimestamp}}).issues.length);
 const before=resolveHistoricalWood(timber,{hts:timber.hts,date:'2025-10-14',origin:'CA',facts,shipment:{entryTimestamp:'2025-10-14T00:00:59-04:00'}});assert.deepEqual(before.issues,[]);assert.equal(before.measures.length,0);assert(before.nonApplicable.some(n=>n.heading==='9903.76.01'));
 assert.deepEqual(resolveHistoricalWood(timber,{hts:timber.hts,date:'2025-10-14',origin:'CA',facts,shipment:{entryTimestamp:'2025-10-14T04:01:00Z'}}).issues,[]);
});

test('the complete actual20(g) heading is China-only; partial scope and China declarations are not cleared',()=>{const rows=JSON.parse(readFileSync(dir+'china-list3-04-public-row.json','utf8'));assert.equal(chapter99NonApplicability(rows,'JP')[0]?.heading,'9903.88.04');assert.deepEqual(chapter99NonApplicability(rows,'CN'),[]);for(const description of [rows[0].description.replace('product of China','product of China or Japan'),rows[0].description+' including foreign components',rows[0].description.replace('20(g)','20(f)')])assert.deepEqual(chapter99NonApplicability([{...rows[0],description}],'JP'),[]);});

test('Taiwan retrospective Section122 exception requires the exact amendment to the retained preceding wood exception list',()=>{
 const patch={from:'2026-04-29',before:'2026-05-22',notes:contexts[2].section122Notes+' '+contexts[2].note37},s=scope(2,'9401614011','TW','2026-05-01',patch);assert(s.overlaps.section122.includes('9903.76.24'));
 for(const actionsChanged of [actions.filter((a:any)=>a.documentNumber!=='2026-10571'),actions.map((a:any)=>a.documentNumber==='2026-10571'?{...a,text:a.text.replace('note 2(aa)(v)(4)','note 33(f)')}:a)]){const changed=scope(2,'9401614011','TW','2026-05-01',{...patch,actions:actionsChanged});assert(!changed.overlaps.section122.includes('9903.76.24'));}
});
