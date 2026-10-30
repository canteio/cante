import {baseBelowThreshold,combinedHeading,type EquivalentInput} from './combined-heading';
import {publishedProgramTable,originalReciprocalTable} from './program-scope';
import {guidanceEntryCutoff,type CbpGuidance} from './cbp-guidance';
import {atEasternCutoff} from '@/app/api/audits/shipment';
import type {Chapter99Action} from './chapter99-contract';
import type {ReferenceRate} from './store';
export type HistoricalPrograms={compiler:'historical-programs-v1'|'historical-programs-v2';date:string;entryTimestamp?:string;cutoffs?:{date:string;time:'00:00'|'00:01';sourceId:string}[];origin:string;hts:string;from:string;before:string;baseEquivalentInput?:EquivalentInput;measures:{heading:string;label:string;rate:string;from:string;before:string;requiredFacts:string[];sourceIds:string[];replacesBase?:boolean}[];notApplicable:{heading:string;reason:string}[];issues:string[];sourceIds:string[]};
const countries:Record<string,string>={CA:'Canada',MX:'Mexico',CN:'China',VN:'Vietnam',JP:'Japan',TW:'Taiwan',KR:'South Korea',DE:'a member state of the European Union',FR:'a member state of the European Union',IT:'a member state of the European Union',GB:'United Kingdom',TH:'Thailand',MY:'Malaysia',IN:'India',ID:'Indonesia',SG:'Singapore',AU:'Australia',NZ:'New Zealand',CH:'Switzerland',LI:'Liechtenstein'};
const euOrigins=new Set('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' '));
for(const origin of euOrigins)countries[origin]='a member state of the European Union';
export const supportedHistoricalOrigin=(origin:string)=>Object.hasOwn(countries,origin);
const combinedAgreements:Record<string,{number:string;from:string;dateText:string;low:string;high:string;old:string;claim:string}>={
 JP:{number:'66242844',from:'2025-08-07',dateText:'August 7, 2025',low:'9903.02.73',high:'9903.02.72',old:'9903.02.30',claim:'sum of the Column 1 and the reciprocal tariff rate is 15 percent'},
 KR:{number:'67045953',from:'2025-11-14',dateText:'November 14, 2025',low:'9903.02.80',high:'9903.02.79',old:'9903.02.56',claim:'combined Column 1 and Reciprocal tariff rate is 15 percent'},
 CH:{number:'67133044',from:'2025-11-14',dateText:'November 14, 2025',low:'9903.02.83',high:'9903.02.82',old:'9903.02.58',claim:'combined Column 1 and additional Reciprocal tariff rate is 15 percent'},
 LI:{number:'67133044',from:'2025-11-14',dateText:'November 14, 2025',low:'9903.02.88',high:'9903.02.87',old:'9903.02.36',claim:'combined Column 1 and additional Reciprocal tariff rate is 15 percent'},
};
const dotted=(s:string)=>`${s.slice(0,4)}.${s.slice(4,6)}.${s.slice(6)}`;
const countryKey=(name:string)=>name.trim().replace(/^a member state of /i,'').replace(/^the /i,'').toLowerCase();
const namedCountry=(row:ReferenceRate,name:string)=>{const named=/articles the product of ([^,]+)/i.exec(row.description)?.[1];return !!named&&countryKey(named)===countryKey(name);};
const additive=(s:string)=>/^The duty provided in the applicable subheading (?:\+|plus) (\d+(?:\.\d+)?)%$/.exec(s.trim())?.[1];
/** Dated, ordinary-commercial program contracts. These never establish origin,
 * product/end-use exemptions, in-transit treatment or U.S./metal content. Those
 * shipment facts need dated evidence decisions. Unsupported arrangements fail
 * visibly rather than accepting a country-wide guessed total. */
export function historicalPrograms(input:{date:string;entryTimestamp?:string;origin:string;hts:string;baseRate?:string;baseInput?:EquivalentInput;from:string;before:string;noteId:string;notes:string;rows:ReferenceRate[];guidance:CbpGuidance[];actions:Chapter99Action[];section122Amendment?:{noteId:string;notes:string}}):HistoricalPrograms{
 let section122Notes=input.notes;
 const {date,origin}=input,result:HistoricalPrograms={compiler:'historical-programs-v1',date,...(input.entryTimestamp?{entryTimestamp:input.entryTimestamp}:{}),cutoffs:[],origin,hts:input.hts,from:input.from,before:input.before,measures:[],notApplicable:[],issues:[],sourceIds:[input.noteId]};
 if(date<'2025-02-04')return result;
 if(!countries[origin]){result.issues.push('Dated country-program treatment requires separate coverage for this origin.');return result;}
 const require=(number:string,checks:(string|RegExp)[])=>{const source=input.guidance.find(g=>g.number===number);if(!source||checks.some(c=>typeof c==='string'?!source.text.includes(c):!c.test(source.text))){result.issues.push(`CBP CSMS ${number} is missing or its operative guidance changed.`);return null;}result.sourceIds.push(source.id);return source;};
 const cutoff=(sources:CbpGuidance[],day:string)=>{
  const proven=sources.flatMap(source=>{const time=guidanceEntryCutoff(source,day);return time?[{date:day,time,sourceId:source.id}]:[];});
  if(!proven.length||new Set(proven.map(p=>p.time)).size!==1)return null;
  result.cutoffs!.push(...proven);return atEasternCutoff(input.entryTimestamp,day,proven[0].time);
 };
 const add=(heading:string,label:string,rate:string,from:string,before:string,fact:string,ids:string[])=>{
  if(date===from){const state=cutoff(input.guidance.filter(g=>ids.includes(g.id)),date);
   if(state!==true){
    // IEEPA ended at 00:00; Section 122 starts at 00:01. Both originals
    // establish this one-minute ordinary-entry gap, rather than a guessed rate.
    const ended=input.guidance.find(g=>g.number==='67834313');
    if(heading==='9903.01.25'&&state===false){const original=input.actions.map(originalReciprocalTable).find(t=>!!t);if(original){result.sourceIds.push(original.sourceId);result.notApplicable.push({heading,reason:'The actual entry precedes the original published 00:01 Eastern creation of this reciprocal heading on April 5, 2025. Independently applicable duties remain.'});return;}}
    if(heading==='9903.01.84'&&state===false){const original=input.actions.find(a=>a.documentNumber==='2025-16419'&&guidanceEntryCutoff(a,'2025-08-27')==='00:01'&&a.text.includes('new HTSUS heading 9903.01.84'));if(original){result.sourceIds.push(original.id);result.notApplicable.push({heading,reason:'The recorded entry precedes the original published 00:01 Eastern start of this new India additional duty; independently applicable duties remain.'});return;}}
    if(heading==='9903.03.01'&&state===false&&ended&&cutoff([ended],date)===true){result.notApplicable.push({heading,reason:'The actual entry precedes the published 00:01 Eastern Section 122 start; the separately cited IEEPA termination is effective at 00:00.'});return;}
    result.issues.push(`${heading}: ${state===false?'entry precedes the published cutoff; preceding treatment needs its own dated coverage':'the legal cutoff on '+date+' requires a consistent actual entry timestamp and its original published time'}.`);return;
   }
  }else if(date===before){result.issues.push(`${heading}: the legal ending cutoff on ${date} requires preceding treatment coverage.`);return;}
  if(date>=from&&date<before)result.measures.push({heading,label,rate,from,before,requiredFacts:[fact],sourceIds:[input.noteId,...ids]});
 };
 if(input.baseInput&&!/^(?:Free|\d+(?:\.\d+)?%)$/i.test(input.baseRate??''))result.baseEquivalentInput=input.baseInput;
 const terminal=date>='2026-02-24'?require('67834313',['February 24, 2026','Executive Order 14195','Executive Order 14257','will no longer be collected','does not affect any other duties']):null;
 if(date==='2026-02-24'&&terminal&&cutoff([terminal],date)!==true)result.issues.push('IEEPA termination requires the actual entry timestamp and its published midnight Eastern cutoff.');
 if(date>='2026-02-24'&&terminal)for(const heading of ['9903.01.20','9903.01.24','9903.01.25','9903.01.63'])result.notApplicable.push({heading,reason:'CBP ended collection of this IEEPA duty for entries from February 24, 2026. Other tariff programs remain independently applicable; this is not a refund determination.'});
 if(date<'2026-02-24'){
  if(['CA','MX'].includes(origin)){
   const canada=origin==='CA',heading=canada?'9903.01.10':'9903.01.01';
   if(date>='2025-03-04'){
    const original=require(canada?'64297449':'64297292',['March 4, 2025',heading,'additional ad valorem rate of duty of 25%']);
    const usmca=date>='2025-03-07'?require(canada?'64336037':'64335789',['March 7, 2025',canada?'9903.01.14':'9903.01.04','USMCA']):null;
    const increase=canada&&date>='2025-08-01'?require('65798609',['August 1, 2025','9903.01.10','35%']):null;
    const source=increase??original,rate=source?new RegExp(heading.replaceAll('.','\\.')+': All imports of articles[^:]{0,800}?additional ad valorem rate of duty of (\\d+(?:\\.\\d+)?)%').exec(source.text)?.[1]:null;
    if(source&&rate)add(heading,`Historical IEEPA ${canada?'Canada':'Mexico'} border duty`,rate+'%',increase?'2025-08-01':'2025-03-04','2026-02-24','border_exceptions_clear',[source.id,...(usmca?[usmca.id]:[])]);
    else if(source)result.issues.push('The original border-duty rate expression was not established.');
   }
   if(date>='2025-04-05'){const exempt=canada?'9903.01.26':'9903.01.27',source=require('64680374',[exempt,`Articles the product of ${canada?'Canada':'Mexico'}`,`excepted from the reciprocal tariff`]);if(source){result.notApplicable.push({heading:'9903.01.25',reason:`The dated ${exempt} country exemption removes reciprocal duty; independently applicable border and other duties remain separate.`});result.measures.push({heading:exempt,label:'Published Canada/Mexico reciprocal exemption',rate:'Free',from:'2025-04-05',before:'2026-02-24',requiredFacts:[],sourceIds:[input.noteId,source.id]});}}
  }
  if(origin==='CN'){
   const original=require('64299816',['February 4, 2025','March 3, 2025','March 4, 2025','applies in addition to all other applicable duties']);
   const updated=date>='2025-11-10'?require('66749380',['Effective November 10, 2025','lowered from 20% to 10%','both the IEEPA Reciprocal Tariffs and the IEEPA Fentanyl Tariffs']):null;
   const heading=date<'2025-03-04'?'9903.01.20':'9903.01.24',source=date>='2025-11-10'?updated:original;
   const expression=new RegExp(heading.replaceAll('.','\\.')+': All imports of articles[^:]{0,850}?additional ad valorem rate of duty of (\\d+(?:\\.\\d+)?)%');
   const rate=source?expression.exec(source.text)?.[1]:null;
   if(source&&rate)add(heading,'Historical IEEPA China fentanyl duty',rate+'%',date<'2025-03-04'?'2025-02-04':date<'2025-11-10'?'2025-03-04':'2025-11-10',date<'2025-03-04'?'2025-03-04':date<'2025-11-10'?'2025-11-10':'2026-02-24','ieepa_exceptions_clear',[source.id]);
   else if(source)result.issues.push('The original China IEEPA rate expression was not established.');
  }
  if(date>='2025-04-05'&&!['CA','MX'].includes(origin)){
   const scope=require('64680374',['April 5, 2025','in addition to any other duties','9903.01.34','at least 20%']);
   let source:CbpGuidance|null=null,heading='9903.01.25',from='2025-04-05',before='2025-04-09',rate:string|null=null,replacesBase=false;const extraIds:string[]=[];
   if(date<'2025-04-09'){source=scope;rate=scope?/9903\.01\.25: Additional ad valorem duty rate of (\d+(?:\.\d+)?)%/.exec(scope.text)?.[1]??null:null;}
   else if(date<'2025-04-10'){
    if(origin==='CN'){source=require('64687696',['April 9, 2025','replacing the previous rate of 34%']);heading='9903.01.63';rate=source?/9903\.01\.63: Articles[^:]{0,350}duty of (\d+(?:\.\d+)?)%/.exec(source.text)?.[1]??null:null;}
    else result.issues.push('The April 9 country-specific transition requires entry time and its dated country rule.');from='2025-04-09';before='2025-04-10';
   }else if(origin==='CN'&&date<'2025-05-14'){
    source=require('64701128',['April 10, 2025','9903.01.63']);heading='9903.01.63';from='2025-04-10';before='2025-05-14';rate=source?/9903\.01\.63: Articles[^:]{0,350}duty of (\d+(?:\.\d+)?)%/.exec(source.text)?.[1]??null:null;
   }else if(origin==='CN'){
    from='2025-05-14';before='2026-02-24';source=date<'2025-08-12'?require('65029337',['May 14, 2025','discontinue the use of heading 9903.01.63']):date<'2025-11-10'?require('65894387',['November 10, 2025','continue to be suspended']):require('66749380',['November 10, 2026','continue to be suspended']);
    rate=source?/9903\.01\.25:[^:]{0,650}duty rate of (\d+(?:\.\d+)?)%/.exec(source.text)?.[1]??null:null;
    if(!rate&&source?.number==='65894387')rate=/reciprocal tariff of (\d+(?:\.\d+)?)% ad valorem/.exec(source.text)?.[1]??null;
   }else if(date<'2025-08-07'){
    from='2025-04-10';before=date<'2025-08-01'?'2025-08-01':'2025-08-07';source=require('64701128',['April 10, 2025','The country-specific rates that became effective on April 9, 2025 are suspended.']);
    if(date>='2025-07-09')require('65573545',['August 1, 2025','additional ad valorem duty rate of 10%']);
    if(date>='2025-08-01'){const extension=input.actions.find(a=>a.documentNumber==='2025-15010'&&a.text.includes('July 31, 2025')&&a.text.includes('7 days after the date of this order')&&a.text.includes('continuing to suspend headings 9903.01.43')&&a.text.includes('until the effective date of the modifications provided in Annex II'));if(extension){extraIds.push(extension.id);result.sourceIds.push(extension.id);}else result.issues.push('The original seven-day reciprocal extension instrument is missing or changed.');}
    rate=source?/9903\.01\.25: Articles[^:]{0,650}duty rate of (\d+(?:\.\d+)?)%/.exec(source.text)?.[1]??null:null;
   }else if(date>='2025-08-07'){
    source=require('65829726',['August 7, 2025','9903.02.']);from='2025-08-07';before='2026-02-24';
    const row=input.rows.filter(r=>/^990302\d{2}$/.test(r.hts)&&namedCountry(r,countries[origin]));
    const agreement=combinedAgreements[origin];
    if(agreement&&date>=agreement.from){
     const proof=require(agreement.number,[agreement.dateText,agreement.low,agreement.high,agreement.claim]);
     const upperZero=proof&&/Column 1(?: \(General or Special, whichever is applicable\))? duty rate greater than or equal to 15 percent(?: ad valorem)?, the additional [Rr]eciprocal tariff is zero/.test(proof.text);
     const below=baseBelowThreshold(input.baseRate??'','15%',input.baseInput);
     const preceding=proof&&date===agreement.from&&agreement.from>'2025-08-07'&&guidanceEntryCutoff(proof,date)==='00:01'&&atEasternCutoff(input.entryTimestamp,date,'00:01')===false;
     const prior=preceding?input.rows.filter(r=>r.hts===agreement.old.replaceAll('.','')&&namedCountry(r,countries[origin])):[];
     if(preceding&&prior.length===1&&additive(prior[0].general)){from='2025-08-07';heading=agreement.old;rate=additive(prior[0].general)!;replacesBase=false;result.notApplicable.push({heading:agreement.low,reason:'The actual entry precedes the published00:01 Eastern combined-country agreement. The separately retained original country heading and its existing additional rate remain applicable for this preceding instant.'});result.sourceIds.push(proof!.id);extraIds.push(proof!.id);}
     else if(proof&&upperZero&&below!==null){source=proof;from=agreement.from;heading=below?agreement.low:agreement.high;rate=below?'15':'0';replacesBase=below;result.notApplicable.push({heading:agreement.old,reason:'The cited implementation instruction retroactively replaces this original country heading within its explicit legal interval; it does not establish refund entitlement.'});}
     else if(proof)result.issues.push('The combined country rate needs both threshold instructions and its exact Column 1 equivalent and shipment quantity.');
    }
    else if(row.length===1){heading=dotted(row[0].hts);rate=additive(row[0].general)??null;}
    else if(euOrigins.has(origin)){const combined=combinedHeading(row.filter(r=>['99030219','99030220'].includes(r.hts)),input.baseRate??'',input.baseInput);if(combined){heading=dotted(combined.row.hts);rate=combined.rate==='Free'?'0':combined.rate.replace('%','');replacesBase=combined.replacesBase;}}
    else if(['GB','AU','SG'].includes(origin)){const general=input.rows.find(r=>r.hts==='99030125');rate=general?additive(general.general)??null:null;}
   }
   if(scope&&source&&rate){add(heading,'Historical IEEPA reciprocal duty',rate+'%',from,before,'reciprocal_exceptions_clear',[scope.id,source.id,...extraIds]);if(replacesBase){const m=result.measures.at(-1);if(m?.heading===heading)m.replacesBase=true;}}
   else if(!result.issues.length)result.issues.push('The historical reciprocal rate was not established.');
  }
 }else if(date<'2026-07-24'){
  const source=require('67844987',['February 24, 2026','July 24, 2026','9903.03.02','9903.03.11']);
  const rate=source?/under heading 9903\.03\.01:[\s\S]{0,900}?additional ad valorem rate of (\d+(?:\.\d+)?)%/.exec(source.text)?.[1]:null;
  // The entry-date edition predates this amendment on Feb 24. A later
  // consolidated note supplies only the exact new 122 table, independently
  // anchored to the retained original proclamation's date/rate/stacking clause.
  // It never replaces the entry-date commodity rate or other tariff programs.
  const amendment=input.section122Amendment,original=input.actions.find(a=>a.documentNumber==='2026-03824'&&a.text.includes('February 24, 2026')&&a.text.includes('10 percent ad valorem')&&a.text.includes('in addition to any other duties, taxes, fees, exactions, and charges applicable to such products')&&guidanceEntryCutoff(a,'2026-02-24')==='00:01');
  if(date==='2026-02-24'&&amendment&&original){section122Notes=amendment.notes;result.sourceIds.push(amendment.noteId,original.id);}
  const note=section122Notes.slice(section122Notes.indexOf('(aa)'),section122Notes.indexOf('(aa)')+6000);
  if(source&&rate)add('9903.03.01','Historical Section 122 surcharge',rate+'%','2026-02-24','2026-07-24','section122_exceptions_clear',[source.id,...(section122Notes!==input.notes?[input.section122Amendment!.noteId,original!.id]:[])]);
  else if(source)result.issues.push('The original Section 122 rate expression was not established.');
  if(result.measures.some(m=>m.heading==='9903.03.01')&&(!note.includes('shall also be subject to any additional duty')||!note.includes('heading 9903.03.01 imposes')))result.issues.push('The dated Section 122 additional-duty/stacking clause is missing or changed.');
 }else{
  const action=input.actions.find(a=>a.documentNumber==='2026-15181'&&a.text.includes('July 24, 2026')&&a.text.includes('9903.05.20')&&a.text.includes('9903.05.84'));
  const note=input.notes.slice(input.notes.indexOf('52. (a)'),input.notes.indexOf('52. (a)')+6000);
  if(!action||!note.includes('shall also be subject to any additional duty')||!note.includes('Notwithstanding U.S. note 1'))result.issues.push('The original dated Note 52 action/stacking contract is missing or changed.');
  else{
   result.sourceIds.push(action.id);const rows=input.rows.filter(r=>r.hts>='99030520'&&r.hts<='99030584'&&namedCountry(r,countries[origin]));
   if(rows.length===1&&additive(rows[0].general))add(dotted(rows[0].hts),'Historical country Section 301 duty',additive(rows[0].general)!+'%','2026-07-24',input.before,'country301_exceptions_clear',[action.id]);
   else{const combined=combinedHeading(rows,input.baseRate??'',input.baseInput);if(combined){const heading=dotted(combined.row.hts);add(heading,'Historical combined country Section 301 duty',combined.rate,'2026-07-24',input.before,'country301_exceptions_clear',[action.id]);const m=result.measures.at(-1);if(m?.heading===heading)m.replacesBase=combined.replacesBase;}else result.issues.push('A unique dated Note 52 country/rate row was not established.');}
  }
 }
 if(['CA','MX'].includes(origin)&&date>='2026-02-24'&&terminal){if(!terminal.text.includes('Executive Order 14193')||!terminal.text.includes('Executive Order 14194'))result.issues.push('The dated border-duty termination orders are missing or changed.');else for(const heading of ['9903.01.01','9903.01.10','9903.01.13','9903.01.15'])result.notApplicable.push({heading,reason:'The cited CBP instruction ends collection of this IEEPA border duty from midnight Eastern time on February 24, 2026. Section 122 and other programs remain independent.'});}
 if(origin==='IN'&&date>='2025-08-27'){
  const original=require('66027027',['August 27, 2025','9903.01.84','applies in addition to the additional duty','identified in Annex II']),stop=require('67702087',['February 7, 2026','no longer subject','9903.01.84']);
  const rate=original?/will be subject to an additional ad valorem rate of (\d+(?:\.\d+)?)%/.exec(original.text)?.[1]:null;
  if(original&&stop&&rate){
   const ending=date==='2026-02-07'?cutoff([stop],date):null;
   if(date<'2026-02-07'||date==='2026-02-07'&&ending===false)add('9903.01.84','Historical India additional IEEPA duty'+(date==='2026-02-07'?' · entry before 00:01 Eastern termination':''),rate+'%','2025-08-27',date==='2026-02-07'?'2026-02-08':'2026-02-07','ieepa_exceptions_clear',[original.id,stop.id]);
   else if(date==='2026-02-07'&&ending!==true)result.issues.push('India additional-duty termination requires the actual entry timestamp and original published cutoff.');
   else for(const heading of ['9903.01.84','9903.01.85','9903.01.86','9903.01.87','9903.01.88','9903.01.89'])result.notApplicable.push({heading,reason:'The cited CBP instruction ends use of this India heading from 00:01 Eastern on February 7, 2026; reciprocal and other programs remain separate.'});
  }
  else if(original&&stop)result.issues.push('The original additional India rate expression was not established.');
 }
 for(const [target,heading,tableHeading,part,next]of [['reciprocal','9903.01.32','9903.01.32','iii','iv'],['india','9903.01.86','9903.01.32','iii','iv'],['section122','9903.03.03','9903.03.03','ii','iii'],['country301','9903.05.86','9903.05.86','b','c']]){
  const measures=result.measures.filter(m=>target==='india'?m.heading==='9903.01.84':m.requiredFacts.includes(target+'_exceptions_clear'));if(!measures.length)continue;
  let table=publishedProgramTable(target==='section122'?section122Notes:input.notes,tableHeading,part,next)??(tableHeading==='9903.01.32'?publishedProgramTable(input.notes,tableHeading,'a','b'):null);
  if(!table&&target==='reciprocal'&&date>='2025-04-05'&&date<'2025-04-09'){
   const original=input.actions.map(originalReciprocalTable).find(t=>!!t);if(original){table=original.codes;result.compiler='historical-programs-v2';result.sourceIds.push(original.sourceId);for(const measure of measures)measure.sourceIds=[...new Set([...measure.sourceIds,original.sourceId])];}
  }
  if(!table){result.issues.push(`${heading}: the complete published HTS-only exemption table was not established.`);continue;}
  if(!table.some(code=>input.hts.startsWith(code)))continue;
  for(const measure of measures){result.notApplicable.push({heading:measure.heading,reason:`The dated published HTS-only exemption ${heading} covers ${input.hts}; no product qualification was inferred from a descriptive or end-use exception.`});result.measures.splice(result.measures.indexOf(measure),1);result.measures.push({...measure,heading,label:'Published HTS-only exemption '+heading,rate:'Free',requiredFacts:[],replacesBase:false});}
 }
 result.sourceIds=[...new Set([...result.sourceIds,...result.measures.flatMap(m=>m.sourceIds)])];return result;
}
