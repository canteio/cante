/** Synthetic legal text tests parser/calculator behavior, never legal accuracy. */
import test from 'node:test';import assert from 'node:assert/strict';
import {chartWindows} from '../app/api/tariff/references/section301-chart';
import {compileExclusionHistory,exclusionCodeIntervals} from '../app/api/tariff/references/exclusion-history';
import {publishedProgramTable} from '../app/api/tariff/references/program-scope';
import {chapter99Rows} from '../app/api/tariff/references/chapter99-table';
import {factDecisionSchema} from '../app/api/audits/model';
const ledger=()=>({parsedDefinitions:0,supportedDefinitions:0,skippedDefinitions:0,unsupportedScopes:[],issues:[]});
const chart=[{heading:'9903.88.05',part:'h',from:'2018-07-06',before:'2019-12-28',sourceIds:['SYNTHETIC-CBP'],publication:'2018-12-28'}];
const intro=(part:string,target='9903.88.01')=>`(${part}) The U.S. Trade Representative determined to establish a process by which particular products classified in heading ${target} could be excluded. The additional duties in heading ${target} shall not apply to the following particular products: `;
const heading=(code:string,part:string)=>`Articles the product of China, as provided for in U.S. note 20(${part}) to this subchapter. ${code} The duty provided in the applicable subheading `;
test('CBP merged rows retain the initial period and never generalize a partial extension',()=>{
 const c=(text:string,x:number,y:number)=>({text,x,y});const rows=[c('9903.88.66',446,543),c('20(sss)',537,530),c('11/16/2021',277,543),c('12/1/2021',368,530),c('5/31/2022',604,543),c('9903.88.66',446,529),c('06/03/2022',277,523),c('11/30/2022',601,523)];
 const [w]=chartWindows([rows],'SYNTHETIC');assert.equal(w.from,'2021-12-01');assert.equal(w.before,'2022-05-31');assert.equal(w.part,'sss');
});
test('historical statistical-code transitions establish disjoint dated scope',()=>{
 const codes=exclusionCodeIntervals('SYNTHETIC pump (described in statistical reporting number 8413.91.9080 prior to January 1, 2019; described in statistical reporting number 8413.91.9095 effective January 1, 2019 through December 31, 2019; described in statistical reporting number 8413.91.9085 or 8413.91.9096 effective January 1, 2020)')!;
 assert.equal(codes.length,4);assert.deepEqual(codes[1],{hts:'8413919095',from:'2019-01-01',before:'2020-01-01'});assert.equal(codes[0].before,'2019-01-01');
 assert.equal(exclusionCodeIntervals('SYNTHETIC motor 8501.31.4000 effective some time in 2020'),null);assert.equal(exclusionCodeIntervals('SYNTHETIC motor (described in statistical reporting number 8501.31.4000 effective February 30, 2020)'),null);
});
test('numbered products without spaces stay separate; the next non-exclusion clause is excluded',()=>{
 const notes=intro('h')+'(1)SYNTHETIC motor (described in statistical reporting number 8501.31.4000) (2)SYNTHETIC pump (described in statistical reporting number 8413.91.9080) (i) For the next legal provision, (1) Unrelated 9999.99.9999. '+heading(chart[0].heading,'h');
 const l=ledger(),defs=compileExclusionHistory(notes,'SYNTHETIC-NOTE',chart,l);assert.equal(defs.length,2);assert.equal(defs[0].scope,'20(h)(1)');assert(!defs[0].description.includes('pump'));assert(!defs.some(d=>d.hts==='9999999999'));
});
test('outer repeated-letter notes and nested Roman groups cannot steal each other’s definitions or dates',()=>{
 const notes=intro('ttt').replace('(ttt) ','(ttt) (i) ')+'(1) SYNTHETIC first (described in statistical reporting number 8501.31.4000) '+intro('ii','9903.88.02')+'(1) SYNTHETIC second (described in statistical reporting number 8413.91.9080) (uuu) For the next note. Effective with respect to entries on or after January 1, 2024, and before June 15, 2024, articles the product of China, U.S. note 20(ttt). 9903.88.67 The duty provided in the applicable subheading Effective with respect to entries on or after June 15, 2024, and through November 9, 2026, articles the product of China, U.S. note 20(vvv). 9903.88.69 The duty provided in the applicable subheading';
 const defs=compileExclusionHistory(notes,'SYNTHETIC-NOTE',[],ledger());assert.equal(defs.length,2);assert.deepEqual(defs.map(d=>d.scope),['20(ttt)(i)(1)','20(ttt)(ii)(1)']);assert(defs.every(d=>d.before==='2024-06-15'));assert(defs.every(d=>d.from==='2024-01-01'));
});
test('duplicate legal product numbers never choose an arbitrary definition',()=>{
 const notes=intro('h')+'(1) SYNTHETIC one (described in statistical reporting number 8501.31.4000) (1) SYNTHETIC other (described in statistical reporting number 8413.91.9080) (i) For next note. '+heading(chart[0].heading,'h');const l=ledger();assert.equal(compileExclusionHistory(notes,'SYNTHETIC',chart,l).length,0);assert.equal(l.skippedDefinitions,2);assert(l.issues.length);
});
test('HTS-only exemption tables preserve complete cells and reject prose, duplicate codes and concatenated headings',()=>{
 const codes=Array.from({length:20},(_,i)=>`1001.10.${String(i).padStart(2,'0')}`),notes=`(b) As provided in heading 9903.05.86, duties shall not apply to articles classifiable in the following provisions: ${codes.join(' ')} (c) As provided in the next heading.`;
 assert.equal(publishedProgramTable(notes,'9903.05.86','b','c')?.length,20);
 for(const changed of [notes.replace(codes[0],codes[1]),notes.replace(codes[0],codes[0]+' for religious use only'),notes.replaceAll('1001.10.00 1001.10.01','10011001'),notes.replace('(c)','(d)')])assert.equal(publishedProgramTable(changed,'9903.05.86','b','c'),null);
});
test('Chapter 99 reads General independently of Special and Column 2',()=>{
 const c=(text:string,x:number,y:number)=>({text,x,y});const cells=[c('Rates of Duty',458,719),c('General',399,701),c('Special',471,701),c('9903.01.25',48,680),c('SYNTHETIC heading description',110.72,680),c('The duty',380.72,660),c('provided in the',383,650),c('applicable subheading + 10%',383,640),c('The duty provided in the applicable subheading + 35%',446,660),c('No change',524,660),c('9903.01.26',48,600)];const [row]=chapter99Rows(cells,'SYNTHETIC',1);assert.equal(row.general,'The duty provided in the applicable subheading + 10%');assert(row.special.endsWith('35%'));assert.equal(row.column2,'No change');assert.equal(chapter99Rows(cells.filter(c=>c.text!=='General'),'SYNTHETIC',1).length,0);
});
test('older and solar exclusion definition identities can be retained without inventing a Roman subdivision',()=>{
 for(const scope of ['20(h)(1)','20(www)(14)','20(ttt)(ii)(15)'])assert(factDecisionSchema.safeParse({row:1,kind:'confirm_facts',note:'SYNTHETIC test evidence decision',evidence:['SYNTHETIC-DOC'],exclusion:'9903.88.05',exclusionScope:scope,facts:{exclusion_qualified:true}}).success);
});

test('official-source intake distinguishes CBP identity paths and access challenges from real evidence',async()=>{
 const {officialReferenceUrl,officialSourceChallenge,archiveIndex}=await import('../app/api/tariff/references/ingestion');
 assert(officialReferenceUrl('https://content.govdelivery.com/accounts/USDHSCBP/bulletins/40b11c9'));
 for(const url of ['https://content.govdelivery.com/accounts/other/bulletins/40b11c9','https://content.govdelivery.com/accounts/USDHSCBP/bulletins/40b11c9?redirect=evil','https://content.govdelivery.com/attachments/other/2025/08/29/file_attachments/1/file.pdf']){assert.throws(()=>officialReferenceUrl(url));}
 const challenge=Buffer.from('<html><title>Challenge</title>Request verification</html>');assert(officialSourceChallenge(challenge));assert.throws(()=>archiveIndex(challenge.toString(),'https://www.usitc.gov/harmonized_tariff_information/hts/archive/list'),/challenge/);assert(!officialSourceChallenge(Buffer.from('%PDF-1.7 real original')));
});

test('an explicitly dated partial renewal extends only the enumerated products',async()=>{
 const {numberedExclusionExtension}=await import('../app/api/tariff/references/exclusion-history');const text="[Compiler's note: Pursuant to notice (84 Fed.Reg. 70616), exclusions in subdivisions (2), (7), (11), (29), (30) and (31) were extended until the close of Dec. 27, 2020; other subdivisions not extended.]";
 const renewal=numberedExclusionExtension(text);assert.deepEqual(renewal?.numbers,['2','7','11','29','30','31']);assert.equal(renewal?.before,'2020-12-28');assert.equal(numberedExclusionExtension(text.replace('Dec. 27','Feb. 30')),null);
 const notes=intro('h')+text+' (1) SYNTHETIC first (described in statistical reporting number 8501.31.4000) (2) SYNTHETIC renewed (described in statistical reporting number 8413.91.9080) (i) For the next provision. '+heading(chart[0].heading,'h'),defs=compileExclusionHistory(notes,'SYNTHETIC-NOTE',chart,ledger());assert(!defs.some(x=>x.scope==='20(h)(1)'&&x.before>'2019-12-28'));assert(defs.some(x=>x.scope==='20(h)(2)'&&x.from==='2019-12-28'&&x.before==='2020-12-28'));
});
