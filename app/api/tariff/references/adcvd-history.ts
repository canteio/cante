import {createHash}from'node:crypto';
import {isStrictIsoDate}from'@/lib/tariff/date';
import {normalizeCountryCode}from'@/lib/tariff/bulk';
import {adcvdCase,cbpMessageDate,type AdcvdHeader}from'./adcvd-source';
import type{ShipmentDetails}from'@/app/api/audits/shipment';
import type{FactValue}from'@/app/api/audits/model';
export type AdcvdReference={reviewCoverage?:{indexMessages:number;loadedDepositMessages:number;otherMessageTypes:{type:string;count:number}[]};caseNumber:string;indexSourceId:string;messages:{headerSourceId:string;bodySourceId:string;header:AdcvdHeader;text:string}[];issues:string[]};
type DepositInstruction={origin:string;from:string;rates:{caseNumber:string;exporters:string[];rate:string;from?:string;before?:string;producers?:string[];excludeExporters?:boolean;excludeProducers?:boolean}[];unchangedOtherRates:boolean;deactivatedCases:string[];supersedesMessage?:string;supersedesDate?:string;supersedesListedCasesOnly?:boolean};
const name=(s:string)=>s.trim().replace(/\s+/g,' ').toLowerCase();
/** Published named-company instruction grammar with source-country identity.
 * Country-wide defaults, unnamed producer fallback, exporter/producer chains,
 * per-unit and importer assessment rates are never guessed from a percentage. */
export function parseCashDeposit(header:AdcvdHeader,text:string):DepositInstruction|null{
 if(header.type!=='CD-Cash Deposit'||header.statusDesc!=='Active'||header.correctionMessage||header.originalImn||header.accessType!=='Public')return null;
 if(text.length>500000)return null;
 const originalText=text;
 // Only typographic normalization: original bodies remain immutable evidence.
 // Do not repair missing values, reinterpret labels or coalesce different rates.
 text=text.replace(/^[ \t]+(?=(?:Exporter|Producer and\/or Exporter|Producer|Case number|Cash deposit rate|Case deposit rate|Amended rate|Final rate):)/gmi,'').replace(/^Cash deposit rate:[ \t]*Cash deposit rate:[ \t]*/gmi,'Cash deposit rate: ');
 const normalizeCountry=(raw:string)=>normalizeCountryCode(raw.trim().replace(/\s*\((?:subject merchandise|[AC]-\d{3}-\d{3})\)$/i,'').replace(/^the /i,'').replace(/^People['’]s Republic of China$/i,'China').replace(/^Socialist Republic of Vietnam$/i,'Vietnam').replace(/^Republic of Korea$/i,'South Korea'));
 const firstParagraph=text.split(/\n\s*\n/).find(p=>/\bCommerce\b/.test(p))?.replace(/\s+/g,' ')??'',country=/\b(?:order|investigation)(?: on)? .{1,2000}? from (.{2,120}?) for the period/i.exec(firstParagraph)?.[1],titleCountry=/\bfrom (.{2,120}?)\s*\([AC]-\d{3}-\d{3}\)/i.exec(header.messageTitle)?.[1],origin=country?normalizeCountry(country):titleCountry?normalizeCountry(titleCountry):'';
 if(!/^[A-Z]{2}$/.test(origin)||titleCountry&&normalizeCountry(titleCountry)!==origin)return null;
 const effective=[...text.matchAll(/for shipments of ([^\n]{1,1500}?)entered, or withdrawn from warehouse, for consumption on or after[ \t]*(\d{2}\/\d{2}\/\d{4})/gi)],from=cbpMessageDate(header.effectiveDate);
 const bounded=[...text.matchAll(/for shipments of ([^\n]{1,1500}?)entered, or withdrawn from warehouse, for consumption during the period (\d{2}\/\d{2}\/\d{4}) through (\d{2}\/\d{2}\/\d{4})/gi)];
 // This observed correction explicitly restores an omitted company and gives
 // two adjacent operative periods. Its body hash is an extraction contract,
 // not approval; rates and dates still come from the complete original text.
 const datedCorrection=header.messageNumber==='2032411'&&header.caseNumberList.length===1&&header.caseNumberList[0]==='C122858'&&createHash('sha256').update(originalText).digest('hex')==='584333a064c319443350f6476969c192d77f2eaf953c48025c114799040c318d';
 if(effective.length!==1||!from||(!datedCorrection&&bounded.length)||(!datedCorrection&&cbpMessageDate(effective[0][2])!==from)||!/\b(?:These cash deposit requirements|This cash deposit requirement) shall remain in effect until further notice\./.test(text)||!text.includes('Do not liquidate any entries'))return null;
 const periods:{start:number;from:string;before?:string}[]=[];
 if(datedCorrection){
  if(bounded.length!==1)return null;
  const begin=cbpMessageDate(bounded[0][2]),through=cbpMessageDate(bounded[0][3]),later=cbpMessageDate(effective[0][2]);if(!begin||!through||!later||begin!==from||begin>through||bounded[0].index!>=effective[0].index!)return null;
  const next=new Date(through+'T00:00:00Z');next.setUTCDate(next.getUTCDate()+1);if(next.toISOString().slice(0,10)!==later)return null;
  periods.push({start:bounded[0].index!,from:begin,before:later},{start:effective[0].index!,from:later});
 }

 // Parse the entire bounded table, including wrapped company names and explicit
 // producer/exporter pairs. No truncated prefix or guessed all-others row.
 const rows=[...text.matchAll(/^(Exporter|Producer and\/or Exporter|Producer):[ \t]*([\s\S]{1,5000}?)\nCase number:[ \t]*([AC]-\d{3}-\d{3}-\d{3})[ \t]*\n(?:Cash deposit rate|Case deposit rate|Amended rate|Final rate):[ \t]*(\d{1,9}(?:\.\d{1,8})?)[ \t]*%[ \t]*\r?$/gmi)];
 if(!rows.length||rows.length>500||rows.length!==(text.match(/^Case number:/gmi)??[]).length||rows.length!==(text.match(/^(?:Cash deposit rate|Case deposit rate|Amended rate|Final rate):/gmi)??[]).length)return null;
 const rates:DepositInstruction['rates']=[];
 const names=(raw:string,aliases=false)=>raw.replace(/\s+/g,' ').trim().split(aliases?/\s+(?:a\.k\.a\.|\/)\s+/i:/\s*;\s*/).map(s=>s.trim());
 for(const r of rows){
  const parties=r[2].trim(),pair=r[1].toLowerCase()==='producer',parts=pair?/^([\s\S]+?)\nExporter:[ \t]*([\s\S]+)$/i.exec(parties):null;
  if(pair&&!parts||/^(?:Producer|Producer and\/or Exporter|Case number|Cash deposit rate):/mi.test(parties)||!pair&&/^Exporter:/mi.test(parties))return null;
  const exporter=pair?parts![2]:parties,producer=pair?parts![1]:undefined;
  const excluded=(raw:string)=>/^Any Company Other than /i.test(raw.replace(/\s+/g,' ').trim());
  const clean=(raw:string)=>raw.replace(/^Any Company Other than /i,'');
  const exporters=names(clean(exporter),r[1].toLowerCase()==='exporter'),producers=producer?names(clean(producer)):undefined;
  if([...exporters,...producers??[]].some(n=>!n||n.length>500)||exporters.length>100||(producers?.length??0)>100||!pair&&excluded(exporter)||/^(?:All Others|Any Company)$/i.test(exporter.trim()))return null;
  const period=datedCorrection?periods.filter(p=>p.start<r.index!).at(-1):undefined;if(datedCorrection&&!period)return null;
  rates.push({caseNumber:r[3],exporters,rate:r[4]+'%',...(period?{from:period.from,...(period.before?{before:period.before}:{})}:{}),...(producers?{producers,excludeExporters:excluded(exporter),excludeProducers:excluded(producer!)}:{})});
 }
 const labels=(text.match(/^(?:Exporter|Producer and\/or Exporter|Producer):/gmi)??[]).length;
 if(labels!==rates.reduce((n,r)=>n+(r.producers?2:1),0)||!datedCorrection&&new Set(rates.map(r=>r.caseNumber)).size!==rates.length||rates.some(r=>!header.caseNumberList.includes(adcvdCase(r.caseNumber).slice(0,7))))return null;
 if(datedCorrection&&(rates.length!==2||rates[0].caseNumber!==rates[1].caseNumber||rates[0].before!==rates[1].from||rates.some(r=>r.exporters.length!==1||r.producers)))return null;
 const deactivatedCases=[...text.matchAll(/deactivated the following [^:.\n]{0,200}:\s*([AC]-\d{3}-\d{3}-\d{3})/g)].map(m=>m[1]);
 if((text.match(/deactivated the following/g)??[]).length!==deactivatedCases.length)return null;
 const inactive=[...text.matchAll(/We have inactivated ([AC]-\d{3}-\d{3}-\d{3})(?: and ([AC]-\d{3}-\d{3}-\d{3}))? because (?:it was a duplicate|they were duplicates) with ([AC]-\d{3}-\d{3}-\d{3})\./g)];
 for(const m of inactive)deactivatedCases.push(m[1],...(m[2]?[m[2]]:[]));
 if((text.match(/We have inactivated/g)??[]).length!==inactive.length)return null;
 const supersession=/^Ref:[ \t]*Message[ \t]+(\d{7,8}), dated (\d{2}\/\d{2}\/\d{4})/m.exec(text),supersedesMessage=supersession&&/\bCommerce has amended the final results\b/.test(text)&&/\bthe amended cash deposit requirement is as follows:/.test(text)&&/^Amended cash deposit instructions /i.test(header.messageTitle)?supersession[1]:undefined;
 return{origin,from,rates,deactivatedCases,...(supersedesMessage?{supersedesMessage,supersedesDate:cbpMessageDate(supersession![2])!,supersedesListedCasesOnly:/changes the cash deposit rate for the producers\/exporters as listed in paragraph 2\./.test(text.replace(/\s+/g,' '))}:{}),unchangedOtherRates:text.includes("If the China or non-China exporter of the subject merchandise has its own rate, use the applicable exporter's rate for determining the cash deposit rate.")||text.replace(/\s+/g,' ').includes("If the exporter of the subject merchandise has its own rate, use the exporter's rate to determine the cash deposit rate.")};

}
export function historicalDeposits(refs:AdcvdReference[],input:{date:string;origin:string;shipment?:ShipmentDetails;facts:Record<string,FactValue|undefined>}){
 const problems:{kind:'shipment_data'|'evidence'|'historical_sources'|'rule_support';reason:string;missing:string}[]=[],add=(kind:typeof problems[number]['kind'],reason:string,missing:string)=>{issues.push(reason);problems.push({kind,reason,missing});};
 const measures:{id:string;rate:string;label:string;sourceIds:string[];legalEffectiveOn:string;messageNumber:string;coverageFrom:string;coverageBefore:string}[]=[],issues:string[]=[],requiredFacts=['adcvd_scope_verified','adcvd_party_verified','adcvd_instructions_clear','adcvd_cases_complete'];
 if(!input.shipment?.cases?.length)return{measures,issues,requiredFacts:[],problems};
 if(!isStrictIsoDate(input.date)){add('shipment_data','Supply a valid historical entry date.','entry date');return{measures,issues,requiredFacts,problems};}
 const next=new Date(input.date+'T00:00:00Z');next.setUTCDate(next.getUTCDate()+1);const coverageBefore=next.toISOString().slice(0,10);
 if(!input.shipment.dutyStage)add('shipment_data','Specify the duty payment stage.','dutyStage');else if(input.shipment.dutyStage!=='cash_deposit')add('rule_support','Final assessment needs the entry/importer-specific liquidation instructions; a deposit rate is not a final duty rate.','dated final-assessment instructions');
 for(const key of requiredFacts)if(input.facts[key]!==true)add('evidence','Confirm '+key.replaceAll('_',' ')+' with dated evidence.',key);
 if(!input.shipment.exporter)add('shipment_data','Supply the exporter’s exact official name; a supplier address or internal identifier is not enough.','exporter');
 if(issues.length)return{measures,issues,requiredFacts,problems};
 for(const declared of input.shipment.cases){
  const normalized=adcvdCase(declared),root=normalized.slice(0,7),ref=refs.find(r=>r.caseNumber===root);if(normalized.length!==10){add('shipment_data',`${declared}: specify the exact company suffix; no country-wide rate is inferred.`,'company-specific AD/CVD case number');continue;}
  if(!ref||ref.issues.length){for(const reason of ref?.issues??[`${declared}: the pinned complete public case index and deposit originals are missing.`])add('historical_sources',reason,'pinned case index and instruction originals');continue;}
  const applicable=ref.messages.filter(m=>{const d=cbpMessageDate(m.header.effectiveDate);return d&&d<=input.date;}).sort((a,b)=>cbpMessageDate(b.header.effectiveDate)!.localeCompare(cbpMessageDate(a.header.effectiveDate)!));
  // An instruction with no operative date cannot silently disappear from the
  // chain just because its publication date is known.
  if(ref.messages.some(m=>!cbpMessageDate(m.header.effectiveDate)&&cbpMessageDate(m.header.messageDate)!<=input.date)){add('historical_sources',`${declared}: a published instruction lacks its operative historical date.`,'instruction effective date');continue;}
  const parsedInstructions=new Map(applicable.map(m=>[m,parseCashDeposit(m.header,m.text)])),groups=new Map<string,typeof applicable>();for(const message of applicable){const instruction=parsedInstructions.get(message),active=instruction?.rates.filter(r=>r.from&&r.from<=input.date&&(!r.before||input.date<r.before)).map(r=>r.from!).sort().at(-1),date=active??cbpMessageDate(message.header.effectiveDate)!;groups.set(date,[...(groups.get(date)??[]),message]);}
  const orderedGroups=[...groups.entries()].sort(([a],[b])=>b.localeCompare(a));
  let selected:typeof measures[number]|null=null;const issueStart=issues.length,chainIds=new Set<string>([ref.indexSourceId]);
  for(const [,messages]of orderedGroups){
   const parsed=messages.map(message=>({message,instruction:parsedInstructions.get(message)??null}));for(const {message}of parsed){chainIds.add(message.headerSourceId);chainIds.add(message.bodySourceId);}
   const unsupported=parsed.find(p=>!p.instruction);if(unsupported){add('rule_support',`${declared}: message ${unsupported.message.header.messageNumber} requires supported interpretation before a prior rate can be carried forward.`,'supported instruction interpretation');break;}
   if(parsed.some(p=>p.instruction!.origin!==input.origin)){add('evidence',`${declared}: the instruction country does not match declared origin ${input.origin}.`,'consistent origin and case scope');break;}
   const deactivated=parsed.find(p=>p.instruction!.deactivatedCases.some(c=>adcvdCase(c)===normalized));if(deactivated){add('evidence',`${declared}: message ${deactivated.message.header.messageNumber} deactivates this company case. Review the replacement case ${deactivated.instruction!.rates.map(r=>r.caseNumber).join(', ')} and affected parties.`,'valid dated company case');break;}
   const operative=parsed.filter(p=>!parsed.some(q=>q.instruction!.supersedesMessage===p.message.header.messageNumber&&q.instruction!.supersedesDate===cbpMessageDate(p.message.header.messageDate)&&cbpMessageDate(q.message.header.messageDate)!>cbpMessageDate(p.message.header.messageDate)!&&(!q.instruction!.supersedesListedCasesOnly||q.instruction!.rates.some(r=>adcvdCase(r.caseNumber)===normalized))));
   const matching=operative.flatMap(p=>p.instruction!.rates.filter(r=>adcvdCase(r.caseNumber)===normalized&&(!r.from||r.from<=input.date)&&(!r.before||input.date<r.before)).map(row=>({...p,row})));
   if(matching.length>1){add('rule_support',`${declared}: overlapping company instructions share an operative date; explicit supersession is required.`,'explicit instruction supersession');break;}
   const match=matching[0];if(match){if(match.row.producers&&(!input.shipment!.manufacturer||/^(?:unknown|n\/?a|not (?:known|supplied)|unspecified)$/i.test(input.shipment!.manufacturer))){add('shipment_data',`${declared}: supply the exact producer name required by the paired company instruction.`,'manufacturer');break;}
    const exporterMatches=match.row.exporters.some(n=>name(n)===name(input.shipment!.exporter!)),producerMatches=match.row.producers?.some(n=>name(n)===name(input.shipment!.manufacturer!));
    if((match.row.excludeExporters?!exporterMatches:exporterMatches)!==true||match.row.producers&&(match.row.excludeProducers?!producerMatches:producerMatches)!==true){add('evidence',`${declared}: exporter/producer evidence does not match the named company conditions in message ${match.message.header.messageNumber}.`,'exact named exporter');break;}selected={id:declared,label:`${declared.startsWith('A-')?'Antidumping':'Countervailing'} cash deposit · ${match.message.header.messageNumber} (not final assessment)`,rate:match.row.rate,sourceIds:[...chainIds],legalEffectiveOn:match.row.from??match.instruction!.from,messageNumber:match.message.header.messageNumber,coverageFrom:input.date,coverageBefore};break;}
   if(parsed.some(p=>!p.instruction!.unchangedOtherRates)){add('rule_support',`${declared}: the later message does not establish continuation of this exporter's prior rate.`,'supported instruction continuation');break;}
  }
  if(selected)measures.push(selected);else if(issues.length===issueStart)add('historical_sources',`${declared}: no dated instruction establishes this company's deposit rate.`,'dated company instruction');
 }
 return{measures,issues,requiredFacts,problems};
}
