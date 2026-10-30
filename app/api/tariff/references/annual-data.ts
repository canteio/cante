import {unzipSync} from 'fflate';
import {parseCsv} from '@/lib/catalogue/csv';
import {isStrictIsoDate} from '@/lib/tariff/date';
import type {ReferenceRate} from './store';
import {annualScheduleSourceIds,type AnnualScheduleIdentity,type AnnualScheduleChanges} from './ordinary-contract';

export const annualManifestUrl='https://dataweb.usitc.gov/assets/content/lists/tariff_annual.json';
export const annualCodeKeyUrl='https://dataweb.usitc.gov/assets/content/annual-tariffs/td-codes.pdf';
export const annualFieldsUrl='https://dataweb.usitc.gov/assets/content/annual-tariffs/td-fields.pdf';
export type AnnualRow={column2Data?:{rateType:string;adValorem:string;specific:string;other:string;fieldsComplete:boolean;textRateAvailable:boolean};record:number;hts8:string;description:string;from:string;through:string;rateType:string;adValorem:string;specific:string;other:string;textRate:string;textRateAvailable?:boolean;special:string;column2:string;units:string[];quantityCodes?:[string,string];footnote:string;additional:string;issue?:string};
export type AnnualQuantityComputation={compiler:'annual-quantity-formula-v1'|'annual-schedule-formula-v2'|'annual-statistical-formula-v1'|'annual-published-formula-v1';method:string;terms:{rate:string;unit:string|null;position?:1|2}[];expression:string;publishedRate:string;fieldsSourceId:string;valueSource:'numeric_fields'|'corroborated_fields'|'corroborated_schedule'|'statistical_schedule'|'corroborated_printed_rate'};
export type AnnualColumn2Treatment={rate:string|null;fieldsSourceId:string|null;computation?:AnnualQuantityComputation;issue?:string;corroborationIssues?:AnnualTariffReference['corroborationIssues'];statisticalTreatment?:AnnualTariffReference['statisticalTreatment'];statisticalCoverage?:AnnualTariffReference['statisticalCoverage'];statisticalIssue?:AnnualTariffReference['statisticalIssue'];statisticalValueCondition?:AnnualTariffReference['statisticalValueCondition'];scheduleCorroboration?:AnnualTariffReference['scheduleCorroboration']};
export type AnnualTariffReference={codeKeyValidated?:boolean;fieldsSourceId?:string|null;definitionIssues?:{reason:string;sourceIds:string[]}[];column2Treatment?:AnnualColumn2Treatment;year:number;sourceId:string;hts8:string;status:'matched'|'missing'|'ambiguous';matchedRows:number;row:AnnualRow|null;mfnRate:string|null;mfnComputation?:AnnualQuantityComputation;quantityIssue?:string;corroborationIssues?:{sourceId:string;reason:string}[];statisticalTreatment?:ReferenceRate['statisticalComponent'];statisticalCoverage?:{from:string;before:string;sourceId:string};statisticalIssue?:{reason:string;sourceIds:string[];suffixes:string[]};statisticalValueCondition?:{relation:'at_most'|'over';amount:string;basis:'complete_ac_movement_per_unit';sourceIds:string[]};scheduleCorroboration?:{generalOnlyNotes?:{sourceId:string;page:number;marker:string;value:string;scope:'general_rate';scopeEvidence:{x:number;y:number;text:string;width?:number;markerCell?:{x:number;y:number;text:string}}}[];excludedExciseNotes?:string[];recoveredMissingFields?:string[];recoveredCurrencyMarker?:boolean;restoration?:{sourceId:string;effectiveOn:string;authority:string;originalBlank:true};annotation?:{sourceId:string;effectiveOn:string;from:string;before:string;previous:string[];established:string[];selected:string;authority:string};kind?:'statistical_components';sourceIds:string[];originals:{sourceId:string;publisherRelease:string;title:string;availableFrom:string;availableBefore:string;page:number;printedRate:string;publishedCodes?:string[];rateSource?:'annual_record'|'chapter_general'|'chapter_column2'}[];reconciledFields:{field:string;retained:string;exact:string}[];dateBasis:string};codeKeySourceId:string|null;selectionIssue?:string;limitation:string;baseDutyScenario?:{amount:string|null;assumption:string}};
export function annualDownloads(raw:unknown){
 if(!Array.isArray(raw)||raw.length>100)throw Error('Invalid annual tariff manifest.');
 const seen=new Set<number>();return raw.map(item=>{const year=Number(item?.text),url=new URL(String(item?.url));if(!Number.isInteger(year)||year<1997||year>2100||seen.has(year)||url.origin!=='https://www.usitc.gov'||url.username||url.password||url.search||url.hash||url.pathname!==`/tariff_affairs/documents/tariff_data/tariff_data_${year}.zip`)throw Error('Unexpected annual tariff download.');seen.add(year);return {year,url:url.toString()};});
}
/** The publisher's pipe-delimited text is authoritative for this projection.
 * Inspect expansion metadata before allocating; never unpack unrelated XLSX. */
export function annualRows(bytes:Uint8Array,year:number):AnnualRow[]{
 if(bytes.length>25000000||!Number.isInteger(year)||year<1997||year>2100)throw Error('Annual tariff archive exceeds its bounds.');
 let expanded=0,entries=0,matched=0;
 const files=unzipSync(bytes,{filter(file){expanded+=file.originalSize;entries++;if(entries>20||!Number.isSafeInteger(expanded)||expanded>40000000||file.originalSize>25000000)throw Error('Annual tariff ZIP expansion exceeds its bounds.');const wanted=new RegExp(`^(?:tariff_database(?:_text_version)?|trade_tariff_database)_${year}(?:\\d{2})?\\.txt$`,'i').test(file.name);if(wanted&&++matched>1)throw Error('Duplicate annual text file.');return wanted;}});
 const originals=Object.values(files);if(matched!==1||originals.length!==1)throw Error('One exact-year annual text original is required.');
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(originals[0]);}catch{text=new TextDecoder('windows-1252',{fatal:true}).decode(originals[0]);}text=text.replace(/^\uFEFF/,'');
 const pipe=text.slice(0,text.indexOf('\n')).startsWith('hts8|');
 let header:string[],records:Record<string,string>[];
 if(pipe){
  // Legacy files use ~ to quote fields containing newlines. Convert only their
  // explicit field delimiters, then reuse the existing strict CSV reader.
  let quoted=false,atStart=true,cell='',converted='',count=0;
  const push=()=>{converted+='"'+cell.replaceAll('"','""')+'"';cell='';atStart=true;};
  for(let i=0;i<text.length;i++){const c=text[i];if(cell.length>12000)throw Error('Annual field exceeds its limit.');if(c==='~'&&atStart&&!quoted){quoted=true;atStart=false;continue;}if(c==='~'&&quoted&&(text[i+1]==='|'||text[i+1]==='\r'||text[i+1]==='\n'||i===text.length-1)){quoted=false;continue;}if(c==='|'&&!quoted){push();converted+=',';continue;}if(c==='\n'&&!quoted){push();converted+='\n';if(++count>100002)throw Error('Annual tariff record limit exceeded.');continue;}if(c==='\r'&&!quoted)continue;cell+=c;atStart=false;}
  if(quoted)throw Error('Unclosed annual field.');if(cell.length||!atStart)push();const table=parseCsv(converted,{columns:180,rawRows:100002,cellCharacters:12000},true);header=table.headers;records=table.rows;
 }
 else {const table=parseCsv(text,{columns:180,rawRows:100002,cellCharacters:12000},true);header=table.headers;records=table.rows;}
 if(header.length>180||new Set(header).size!==header.length)throw Error('Invalid annual tariff columns.');
 for(const field of ['hts8','brief_description','begin_effect_date','end_effective_date','mfn_rate_type_code','mfn_ad_val_rate','mfn_specific_rate','mfn_other_rate'])if(!header.includes(field))throw Error('Annual tariff required field missing: '+field);
 const date=(value:string)=>{const match=/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: 0?0:00:00)?$/.exec(value);const iso=match?`${match[3]}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`:'';if(!isStrictIsoDate(iso))throw Error('Invalid annual effective date.');return iso;};
 const rows:AnnualRow[]=[];for(const [i,record]of records.entries()){
  if(!/^\d{8}$/.test(record.hts8))throw Error('Annual legal tariff code must preserve eight digits.');let from='',through='',issue:string|undefined;try{from=date(record.begin_effect_date);through=date(record.end_effective_date);if(through<from)issue='Source effective interval is reversed.';}catch{issue='Source effective date is invalid or missing.';}
  rows.push({record:i+1,hts8:record.hts8,description:record.brief_description,from,through,rateType:record.mfn_rate_type_code,adValorem:record.mfn_ad_val_rate,specific:record.mfn_specific_rate,other:record.mfn_other_rate,textRate:record.mfn_text_rate??'',textRateAvailable:header.includes('mfn_text_rate'),special:record.col1_special_text??'',column2:record.col2_text_rate??'',...(header.some(h=>h.startsWith('col2_'))?{column2Data:{rateType:record.col2_rate_type_code??'',adValorem:record.col2_ad_val_rate??'',specific:record.col2_specific_rate??'',other:record.col2_other_rate??'',fieldsComplete:['col2_rate_type_code','col2_ad_val_rate','col2_specific_rate','col2_other_rate'].every(h=>header.includes(h)),textRateAvailable:header.includes('col2_text_rate')}}:{}),units:[record.quantity_1_code,record.quantity_2_code].filter(Boolean),quantityCodes:[record.quantity_1_code??'',record.quantity_2_code??''],footnote:record.footnote_comment??'',additional:record.additional_duty??record.additional_tariff_num_ind??'',...(issue?{issue}: {})});
 }
 if(!rows.length)throw Error('Annual tariff archive contains no records.');return rows;
}
export function hasAnnualCodeContract(text:string){const clean=text.replace(/\s+/g,' ');return clean.includes('Tariff Database Code Key')&&/0 Duty rate is free\. No computation necessary/.test(clean)&&/7 Ad Valorem rate\*Value/.test(clean)&&/T This duty must be computed at the 10-digit level/.test(clean);}
/** Exact documented equations and unit meanings. Unknown/ambiguous NA and X
 * units never become usable quantities. No unit conversion is inferred. */
export function annualQuantityCodeContract(text:string):string[]{
 const clean=text.replace(/\s+/g,' '),equations=['1 Specific rate*Q1','2 Specific rate*Q2','3 (Specific rate*Q1) + ("Other" rate*Q2)','4 (Specific rate*Q1) + (Ad Valorem rate*Value)','5 (Specific rate*Q2) + (Ad Valorem rate*Value)','6 (Specific rate*Q1) + ("Other" rate*Q2) + (Ad Valorem rate*Value)'];
 if(!hasAnnualCodeContract(clean)||!equations.every(e=>clean.includes(e))||!clean.includes('Q1 refers to the first unit of quantity value in U.S. trade data. Q2 refers to the second unit of quantity in U.S. trade data.'))return [];
 const start=clean.indexOf('D. Description of quantity codes');if(start<0)return [];const units=clean.slice(start);
 const definitions:Record<string,string>={BBL:'barrels',CAR:'carats',CC:'cubic centimeters',CG:'centigrams',CGM:'component grams',CKG:'component kilograms',CM:'centimeters',CM2:'square centimeters',CM3:'cubic centimeters',CTN:'component tons',CYK:'clean yield kilograms',DOZ:'dozens',DPC:'dozen pieces',DPR:'dozen pairs',G:'grams',GCN:'gross containers',GKG:'gold content grams',GM:'grams',GR:'gross',GRL:'gross lines',GRS:'gross',HND:'hundred units',HUN:'hundred units',JWL:'jewels',K:'thousand units',KG:'kilograms',KTS:'kilograms total sugars',L:'liters',LNM:'linear meters',LTR:'liters',M:'meters',M2:'square meters',M3:'cubic meters',MG:'milligrams',ML:'milliliters',MM:'millimeters',NO:'number',PCS:'pieces',PFL:'proof liters',PK:'pack',PRS:'pairs',SME:'square meters equivalent',SQM:'square meters',T:'metric tons',THS:'thousand units',TNV:'ton raw value',TON:'tons'};
 return Object.entries(definitions).filter(([code,meaning])=>new RegExp('(?:^| )'+code+' '+meaning+'(?: |$)').test(units)).map(([code])=>code);
}
export function hasAnnualQuantityFieldsContract(text:string){
 const clean=text.replace(/\s+/g,' ');return clean.includes('USITC Tariff Database Fields')&&['QUANTITY_1_CODE Abbreviation code of first unit of quantity','QUANTITY_2_CODE Abbreviation code of second unit of quantity','MFN_AD_VAL_RATE Ad valorem portion of the MFN duty rate (.05 = 5%)','MFN_SPECIFIC_RATE Specific portion of the MFN duty rate (.05 = $.05 per unit of quantity)','MFN_OTHER_RATE Additional portion of the MFN duty rate (.05 =$.05 per unit of quantity)'].every(s=>clean.includes(s));
}
/** Verify separate Column 2 field meanings; MFN definitions cannot stand in. */
export function hasAnnualColumn2FieldsContract(text:string){
 const clean=text.replace(/\s+/g,' ');return clean.includes('USITC Tariff Database Fields')&&['QUANTITY_1_CODE Abbreviation code of first unit of quantity','QUANTITY_2_CODE Abbreviation code of second unit of quantity','COL2_TEXT_RATE Column 2 duty rates in text format','COL2_RATE_TYPE_CODE Duty code for Column 2 tariff calculation','COL2_AD_VAL_RATE Ad valorem portion of the Column 2 duty rate (.05 = 5%)','COL2_SPECIFIC_RATE Specific portion of the Column 2 duty rate (.05 = $.05 per unit of quantity)','COL2_OTHER_RATE Additional portion of the Column 2 duty rate (.05 = $.05 per unit of quantity)'].every(s=>clean.includes(s));
}
const quantityUnitAliases:Record<string,RegExp>={kg:/^(?:kg|kilograms?)$/,no:/^(?:each|articles?|no|number|units?)$/,l:/^(?:l|liters?|litres?)$/,pfl:/^(?:pf\.? liters?|proof liters?)(?: on ethyl alcohol content)?$/,prs:/^(?:pr|pairs?)$/,doz:/^(?:doz|dozens?)$/,dpr:/^(?:doz\.? prs?|dozen pairs?)$/,pcs:/^(?:pcs|pieces?|each)$/,bbl:/^(?:bbl|barrels?)$/,m2:/^(?:m2|m²|square meters?)(?: of recording surface)?$/,m3:/^(?:m3|m³|cubic meters?)$/,ckg:/^kg on (?:molybdenum|tungsten|lead|copper|zinc|manganese|chromium|nickel|cobalt) content$/,cyk:/^(?:clean kg|kg clean yield)$/,kts:/^kg(?: of)? total sugars$/,grs:/^(?:gross|grs)$/,gr:/^(?:gross|gr)$/,grl:/^(?:line|lines)$/,ths:/^(?:1000|1,000|thousand)$/,jwl:/^(?:jewels?|jwl)$/,t:/^(?:metric tons?|t)$/,g:/^(?:g|grams?)$/,gm:/^(?:gm|grams?)$/,mg:/^(?:mg|milligrams?)$/,ml:/^(?:ml|milliliters?)$/,lnm:/^(?:lin\.? m|linear meters?)$/};
/** Corroborate numeric fields against the complete printed rate. Conditional
 * prose, extra amounts and unknown unit wording cannot silently disappear. */
function printedQuantityFormula(row:AnnualRow,terms:AnnualQuantityComputation['terms']){
 if(!row.textRate&&row.textRateAvailable===false)return true;
 const parts=row.textRate.trim().split(/\s*\+\s*/);if(parts.length!==terms.length)return false;

 const fraction=(s:string)=>{const [a,b='']=s.split('.');return{n:BigInt(a+b),d:10n**BigInt(b.length)};},equal=(a:string,b:string,divisor=1n)=>{const x=fraction(a),y=fraction(b);return x.n*y.d===y.n*x.d*divisor;};
 const remaining=[...terms];
 for(const part of parts){const av=/^(\d+(?:\.\d{1,12})?)\s*%$/.exec(part);let index=-1;
  if(av)index=remaining.findIndex(t=>t.unit===null&&equal(av[1],t.rate.slice(0,-1)));
  else{const m=/^(?:\$\s*(\d+(?:\.\d{1,12})?)|(\d+(?:\.\d{1,12})?)\s*(?:¢|cents?))\s*(?:\/\s*|per\s+|\s+)(.+)$/i.exec(part);if(!m)return false;
   const unit=m[3].toLowerCase().trim().replace(/\.$/,'');index=remaining.findIndex(t=>t.unit!==null&&!!quantityUnitAliases[t.unit]?.test(unit)&&equal(m[1]??m[2],t.rate.slice(1,t.rate.indexOf('/')),m[1]?1n:100n));
  }
  if(index<0)return false;remaining.splice(index,1);
 }
 return !remaining.length;
}
export function annualQuantityComputation(row:AnnualRow,units:string[],fieldsSourceId:string):AnnualQuantityComputation|null{
 if(row.issue||!fieldsSourceId||!row.quantityCodes||!['1','2','3','4','5','6'].includes(row.rateType))return null;
 const decimal=/^\d{1,9}(?:\.\d{1,12})?$/,zero=(v:string)=>/^0(?:\.0+)?$/.test(v),type=row.rateType;
 if(![row.specific,row.other,row.adValorem].every(v=>decimal.test(v)))return null;
 if(['1','2','3'].includes(type)&&!zero(row.adValorem)||['1','2','4','5'].includes(type)&&!zero(row.other))return null;
 const terms:AnnualQuantityComputation['terms']=[];
 for(const [position,amount]of(type==='3'||type==='6'?[[1,row.specific],[2,row.other]]:[[type==='2'||type==='5'?2:1,row.specific]])as[1|2,string][]){const code=row.quantityCodes[position-1];if(!units.includes(code))return null;terms.push({rate:'$'+amount+'/'+code.toLowerCase(),unit:code.toLowerCase(),position});}
 if(type==='4'||type==='5'||type==='6'){const rate=percent(row.adValorem,true);if(rate===null)return null;terms.push({rate,unit:null});}
 if(new Set(terms.filter(t=>t.unit).map(t=>t.unit)).size!==terms.filter(t=>t.unit).length)return null;
 if(!printedQuantityFormula(row,terms))return null;
 const expression=terms.map(t=>t.rate).join(' + ');if(expression.length>100)return null;
 return{compiler:'annual-quantity-formula-v1',method:type,terms,expression,publishedRate:row.textRate,fieldsSourceId,valueSource:row.textRateAvailable===false?'numeric_fields':'corroborated_fields'};
}
const exactDecimal=(value:string)=>{if(!/^\d{1,9}(?:\.\d{1,12})?$/.test(value))return null;const [a,b='']=value.split('.');return{n:BigInt(a+b),d:10n**BigInt(b.length)};};
function decimalText(n:bigint,places:number){const d=10n**BigInt(places),tail=(n%d).toString().padStart(places,'0').replace(/0+$/,'');return String(n/d)+(tail?'.'+tail:'');}
/** Consume the entire printed expression and bind each term to the documented
 * quantity position. No numerical field is silently rounded or guessed. */
function printedAnnualTerms(raw:string,row:AnnualRow,units:string[]):AnnualQuantityComputation['terms']|null{
 const positions=({1:[1],2:[2],3:[1,2],4:[1],5:[2],6:[1,2],7:[]} as Record<string,(1|2)[]>)[row.rateType],av=['4','5','6','7'].includes(row.rateType);
 if(!positions||!row.quantityCodes||raw.length>100||!raw.trim())return null;
 const codes=positions.map(p=>({position:p,unit:row.quantityCodes![p-1].toLowerCase()}));if(codes.some(c=>!units.includes(c.unit.toUpperCase()))||new Set(codes.map(c=>c.unit)).size!==codes.length)return null;
 const parts=raw.trim().split(/\s*\+\s*/);if(parts.length!==positions.length+Number(av))return null;
 const terms:AnnualQuantityComputation['terms']=[];
 for(const part of parts){const percent=/^(\d{1,9}(?:\.\d{1,12})?)\s*%$/.exec(part);
  if(percent){const r=exactDecimal(percent[1]);if(!av||!r||terms.some(t=>t.unit===null))return null;terms.push({rate:decimalText(r.n,percent[1].split('.')[1]?.length??0)+'%',unit:null});continue;}
  const m=/^(?:\$\s*(\d{1,9}(?:\.\d{1,12})?)|(\d{1,9}(?:\.\d{1,12})?)\s*(?:¢|cents?))\s*(?:\/\s*|per\s+|\s+)(.+)$/i.exec(part);if(!m)return null;
  const word=m[3].toLowerCase().trim().replace(/\.$/,''),matches=codes.filter(c=>quantityUnitAliases[c.unit]?.test(word));if(matches.length!==1||terms.some(t=>t.position===matches[0].position))return null;
  const amount=m[1]??m[2],r=exactDecimal(amount);if(!r)return null;const dollars=decimalText(r.n,(amount.split('.')[1]?.length??0)+(m[1]?0:2));
  terms.push({...matches[0],rate:'$'+dollars+'/'+matches[0].unit});
 }
 if(positions.some(p=>!terms.some(t=>t.position===p))||terms.filter(t=>t.unit===null).length!==Number(av))return null;
 return terms.sort((a,b)=>(a.position??3)-(b.position??3));
}
export type AnnualScheduleEvidence={identity:AnnualScheduleIdentity;sourceId:string;rate:ReferenceRate|null;annotationRates?:ReferenceRate[];statisticalPrefix?:boolean;statisticalSuffixes?:string[];statisticalContract?:boolean;issue?:string};
/** The dated annual row supplies applicability. Same-year original tables
 * corroborate its complete printed formula, never substitute a later rate.
 * Every applicable retained candidate must agree. This narrowly reconciles the
 * known two-decimal loss; other contradictions and qualifications stay open. */
export function corroborateAnnualRate(annual:AnnualTariffReference,entry:{date:string;hts:string},evidence:AnnualScheduleEvidence[],units:string[],fieldsSourceId:string,provenanceIssues:string[]=[],column:'general'|'column2'='general'):AnnualTariffReference{
 const row=annual.row;if(![2016,2017].includes(annual.year)||annual.status!=='matched'||!row||annual.mfnRate!==null||!fieldsSourceId||!annual.codeKeySourceId||!row.textRateAvailable||!isStrictIsoDate(entry.date)||!/^\d{10}$/.test(entry.hts)||entry.date.slice(0,4)!==String(annual.year)||entry.hts.slice(0,8)!==row.hts8||row.issue||!isStrictIsoDate(row.from)||!isStrictIsoDate(row.through)||entry.date<row.from||entry.date>row.through||provenanceIssues.length)return annual;
 const decimal=/^\d{1,9}(?:\.\d{1,12})?$/,zero=(v:string)=>/^0(?:\.0+)?$/.test(v);
 if(!['1','2','3','4','5','6','7'].includes(row.rateType)||![row.specific,row.other,row.adValorem].every(v=>decimal.test(v))||['1','2','3'].includes(row.rateType)&&!zero(row.adValorem)||['1','2','4','5','7'].includes(row.rateType)&&!zero(row.other)||row.rateType==='7'&&!zero(row.specific))return annual;
 const candidates=evidence.filter(e=>e.identity.year===annual.year&&e.identity.chapter===entry.hts.slice(0,2)&&row.from<=e.identity.availableFrom&&e.identity.availableFrom<=row.through);if(!candidates.length)return annual;
 let terms:AnnualQuantityComputation['terms']|null=null;const originals:NonNullable<AnnualTariffReference['scheduleCorroboration']>['originals']=[],sourceIds=new Set<string>();
 for(const e of candidates){
  if(e.issue||!e.rate||e.rate.hts!==entry.hts||e.rate.source_id!==e.sourceId||e.rate.projection!=='official-annual-chapter-v1'||e.rate.footnotes.length||e.rate.additional_duties||!e.rate.pdfPage)return annual;
  const parsed=printedAnnualTerms(e.rate[column],row,units);if(!parsed||!printedQuantityFormula(row,parsed)||terms&&JSON.stringify(parsed)!==JSON.stringify(terms))return annual;terms=parsed;
  originals.push({sourceId:e.sourceId,publisherRelease:e.identity.publisherRelease,title:e.identity.description,availableFrom:e.identity.availableFrom,availableBefore:e.identity.availableBefore,page:e.rate.pdfPage,printedRate:e.rate[column]});
  for(const id of[e.sourceId,...annualScheduleSourceIds(e.identity)])sourceIds.add(id);
 }
 if(!terms)return annual;const reconciledFields:NonNullable<AnnualTariffReference['scheduleCorroboration']>['reconciledFields']=[];
 for(const t of terms){const field=t.unit===null?'adValorem':t.position===2&&['3','6'].includes(row.rateType)?'other':'specific',retained=row[field],amount=t.unit===null?t.rate.slice(0,-1):t.rate.slice(1,t.rate.indexOf('/')),p=exactDecimal(amount),r=exactDecimal(retained);if(!p||!r)return annual;const precise={n:p.n,d:p.d*(t.unit===null?100n:1n)};
  if(r.n*precise.d===precise.n*r.d)continue;
  if(r.n*100n!==(precise.n*100n/precise.d)*r.d)return annual;
  const places=(amount.split('.')[1]?.length??0)+(t.unit===null?2:0);reconciledFields.push({field,retained,exact:decimalText(p.n,places)});
 }
 const expression=terms.map(t=>t.rate).join(' + ');if(expression.length>100)return annual;
 const {quantityIssue:_issue,...original}=annual;
 return{...original,mfnRate:expression,mfnComputation:{compiler:'annual-schedule-formula-v2',method:row.rateType,terms,expression,publishedRate:row.textRate,fieldsSourceId,valueSource:'corroborated_schedule'},scheduleCorroboration:{sourceIds:[...sourceIds].sort(),originals,reconciledFields,dateBasis:'Applicability comes from the exact annual effective-date row, bounded to its captured year. Same-year schedule originals corroborate its unchanged printed formula; their availability dates are not used as legal effective dates or as a substitute historical rate. Declared historical classification and origin remain assumptions.'}};
}
type WatchPart='movement'|'case'|'strap'|'battery'|'apparatus';
/** Parse every parent charge, including its named component. Rates on a combined
 * movement/case never apply to a case-only value. DJWL is an explicitly supplied
 * dutiable-jewel quantity, never total jewels minus an assumed exemption. */
export function watchComponentFormula(raw:string,component:NonNullable<ReferenceRate['statisticalComponent']>):{parent:string;terms:AnnualQuantityComputation['terms']}|null{
 if(raw.length>300)return null;raw=raw.toLowerCase().replace(/\s+/g,'');
 const physical=(role:string):WatchPart[]=>role==='movement_case'?['movement','case']:role==='ac_article'?(component.group==='r'?['movement']:['movement','case']):[role as WatchPart];
 const declared=[...new Set(component.required.flatMap(r=>physical(r.role)))],charges:{parts:WatchPart[];rate:string;unit:string|null}[]=[];
 if(raw.length>300||!raw.trim()||!component.required.length||component.required.length>4||!component.required.some(r=>r.suffix===component.suffix&&r.role===component.role))return null;
 if(raw.trim()==='free')return{parent:'Free',terms:[{rate:'Free',unit:null}]};
 const pieces=raw.trim().split(/\s*\+\s*/);if(pieces.length>4)return null;
 for(const piece of pieces){
  const pct=/^(\d{1,9}(?:\.\d{1,12})?)%on(?:the)?(.+)$/.exec(piece);
  if(pct){const targets:Record<string,WatchPart[]>={'movement':['movement'],'case':['case'],'strap,bandorbracelet':['strap'],'battery':['battery'],'apparatus':['apparatus'],'movementandcase':['movement','case'],'caseandstrap,bandorbracelet':['case','strap']},parts=targets[pct[2]];if(!parts)return null;charges.push({parts,rate:pct[1]+'%',unit:null});continue;}
  const specific=/^(?:\$(\d{1,9}(?:\.\d{1,12})?)|(\d{1,9}(?:\.\d{1,12})?)(?:¢|cents?))(each|\/jewelover7)$/.exec(piece);if(!specific)return null;
  const amount=specific[1]??specific[2],n=exactDecimal(amount);if(!n)return null;const unit=specific[3]==='each'?'no':'djwl',rate='$'+decimalText(n.n,(amount.split('.')[1]?.length??0)+(specific[1]?0:2))+'/'+unit;
  if(unit==='djwl'&&!component.required.some(r=>r.role==='movement'&&r.dutiableJewels))return null;
  charges.push({parts:[declared.includes('movement')?'movement':'apparatus'],rate,unit});
 }
 // Every published term is accounted for. Only an explicitly published AC-only
 // reporting branch excludes the battery component from the article formula.
 if(charges.some(c=>c.parts.some(p=>!declared.includes(p)&&!(p==='battery'&&component.branch==='ac')))||charges.filter(c=>c.unit==='no').length>1||charges.filter(c=>c.unit==='djwl').length>1)return null;
 const selected=physical(component.role),terms:AnnualQuantityComputation['terms']=[];
 for(const charge of charges){const overlap=selected.some(p=>charge.parts.includes(p));if(!overlap)continue;if(!selected.every(p=>charge.parts.includes(p))&&charge.unit===null)return null;terms.push({rate:charge.rate,unit:charge.unit});}
 if(terms.length>3)return null;
 // A complete whole-article formula gives no independent charge for a component
 // not named in any term; this zero is derived only after all terms are consumed.
 return{parent:charges.map(c=>c.parts.join('&')+':'+c.rate).join(' + '),terms:terms.length?terms:[{rate:'Free',unit:null}]};
}
export function corroborateAnnualStatisticalRate(annual:AnnualTariffReference,entry:{date:string;hts:string},evidence:AnnualScheduleEvidence[],fieldsSourceId:string,provenanceIssues:string[]=[],column:'general'|'column2'='general'):AnnualTariffReference{
 const row=annual.row;if(!Number.isInteger(annual.year)||annual.year<2000||annual.year>2017||annual.status!=='matched'||!row||!['T','0'].includes(row.rateType)||annual.mfnRate!==null||!fieldsSourceId||!annual.codeKeySourceId||!/^91\d{8}$/.test(entry.hts)||!isStrictIsoDate(entry.date)||entry.date.slice(0,4)!==String(annual.year)||entry.hts.slice(0,8)!==row.hts8||row.issue||!isStrictIsoDate(row.from)||!isStrictIsoDate(row.through)||entry.date<row.from||entry.date>row.through||provenanceIssues.length)return annual;
 const candidates=evidence.filter(e=>e.identity.year===annual.year&&e.identity.chapter==='91'&&(row.textRateAvailable?e.identity.availableBefore>row.from:row.from<=e.identity.availableFrom)&&e.identity.availableFrom<=row.through);if(!candidates.length)return annual;
 const contemporaneous=candidates.filter(e=>e.identity.availableFrom<=entry.date&&entry.date<e.identity.availableBefore);if(contemporaneous.length!==1)return{...annual,quantityIssue:'No unique contemporaneous statistical reporting edition covers this entry date. The annual legal-line formula alone does not establish dated component reporting; a later note was not substituted.'};const reportingEdition=contemporaneous[0];
 let terms:AnnualQuantityComputation['terms']|null=null,component:ReferenceRate['statisticalComponent'],valueCondition:AnnualTariffReference['statisticalValueCondition'];const originals:NonNullable<AnnualTariffReference['scheduleCorroboration']>['originals']=[],sourceIds=new Set<string>();
 for(const e of candidates){const r=e.rate,c=r?.statisticalComponent,noteOnly=r?.projection==='official-annual-statistical-note-v1';if(e.issue||!r||r.hts!==entry.hts||r.source_id!==e.sourceId||!['official-annual-statistical-v1','official-annual-statistical-note-v1'].includes(r.projection??'')||noteOnly&&(!row.textRateAvailable||r[column]!==''||r.footnotes.length!==0)||r.additional_duties||!r.pdfPage||!c||c.note!=='91:1'||c.suffix!==entry.hts.slice(8)||!noteOnly&&!r.footnotes.length||r.footnotes.some(raw=>{const f=raw as{marker?:string;value?:string};return f.marker!=='1'||f.value!=='See statistical note 1 to this chapter.';}))return annual;
  const exact=watchComponentFormula(noteOnly?row.textRate:r[column],c),dated=row.textRateAvailable?watchComponentFormula(row.textRate,c):watchComponentFormula(reportingEdition.rate?.[column]??'',c);if(!exact||!dated||exact.parent!==dated.parent||JSON.stringify(exact.terms)!==JSON.stringify(dated.terms)||terms&&JSON.stringify(terms)!==JSON.stringify(exact.terms)||component&&JSON.stringify({note:component.note,group:component.group,role:component.role,suffix:component.suffix,branch:component.branch,required:component.required})!==JSON.stringify({note:c.note,group:c.group,role:c.role,suffix:c.suffix,branch:c.branch,required:c.required}))return annual;
  if(c.group==='r'&&c.branch==='ac'){
   const pattern=/\bvalued (not over|over) \$(\d{1,9}(?:\.\d{1,2})?) each\b/ig,datedLimits=[...row.description.matchAll(pattern)],printedLimits=[...r.description.matchAll(pattern)];
   if(datedLimits.length||printedLimits.length){if(datedLimits.length!==1||printedLimits.length!==1||datedLimits[0][1].toLowerCase()!==printedLimits[0][1].toLowerCase()||datedLimits[0][2]!==printedLimits[0][2])return annual;const [whole,part='']=datedLimits[0][2].split('.'),condition={relation:datedLimits[0][1].toLowerCase()==='not over'?'at_most' as const:'over' as const,amount:whole+'.'+part.padEnd(2,'0'),basis:'complete_ac_movement_per_unit' as const,sourceIds:[] as string[]};if(valueCondition&&(condition.relation!==valueCondition.relation||condition.amount!==valueCondition.amount))return annual;valueCondition=condition;}
  }
  terms=exact.terms;component=c;originals.push({sourceId:e.sourceId,publisherRelease:e.identity.publisherRelease,title:e.identity.description,availableFrom:e.identity.availableFrom,availableBefore:e.identity.availableBefore,page:r.pdfPage,printedRate:r[column],rateSource:noteOnly?'annual_record':column==='column2'?'chapter_column2':'chapter_general'});for(const id of[e.sourceId,...annualScheduleSourceIds(e.identity)])sourceIds.add(id);
 }
 if(!terms||!component)return annual;const expression=terms.map(t=>t.rate).join(' + ');if(expression.length>100)return annual;
 return{...annual,mfnRate:expression,mfnComputation:{compiler:'annual-statistical-formula-v1',method:row.rateType,terms,expression,publishedRate:row.textRateAvailable?row.textRate:reportingEdition.rate![column],fieldsSourceId,valueSource:'statistical_schedule'},statisticalTreatment:component,...(valueCondition?{statisticalValueCondition:{...valueCondition,sourceIds:[...sourceIds].sort()}}:{}),statisticalCoverage:{from:reportingEdition.identity.availableFrom,before:reportingEdition.identity.availableBefore,sourceId:reportingEdition.sourceId},scheduleCorroboration:{kind:'statistical_components',sourceIds:[...sourceIds].sort(),originals,reconciledFields:[],dateBasis:'The exact annual row supplies the effective-date interval within its captured year. Its complete printed formula must agree when present; legacy files without printed rate text use the contemporaneous original chapter formula and never its numeric sentinel fields. One contemporaneous published-edition window bounds the statistical reporting evidence; availability is a coverage boundary, not a claimed legal effective date. All retained applicable same-year Statistical Note 1 and General-column originals must agree. A missing General-row extraction remains explicitly identified; only the complete dated annual formula can supply its rate, never a sentinel field. Available General rows must still agree. No later statistical table is substituted for an uncovered date. Component values must sum to the explicitly supplied article total; classification, origin, grouping and valuation remain declared facts. Selected tariff column: '+column+'.'}};
}
/** These complete notes concern excise taxes, which the import flow explicitly
 * excludes from its customs-duty comparison. Other footnotes still block. */
export function annualDutyFootnoteSupported(note:string,statisticalEstablished=false){return !note||statisticalEstablished&&/^See statistical note 1 to this chapter[.]$/.test(note)||/^<spec>\s+Imports under this subheading may be subject to Federal Excise Tax \(26 U\.S\.C\. (?:5041|5001, 26 U\.S\.C\. 5041 or 26 U\.S\.C\. 5051)\)\.$/.test(note);}
function percent(fraction:string,expanded=false){if(!(expanded?/^\d{1,9}(?:\.\d{1,12})?$/:/^(?:0(?:\.\d{1,12})?|1(?:\.0{1,12})?)$/).test(fraction))return null;const [whole,part='']=fraction.split('.');const numerator=BigInt(whole+part)*100n,scale=10n**BigInt(part.length),a=numerator/scale,b=(numerator%scale).toString().padStart(part.length,'0').replace(/0+$/,'');return String(a)+(b?'.'+b:'')+'%';}
/** Only documented simple MFN expressions become a base-only scenario. No
 * inference of legal origin, preferences, statistical suffixes or stacked duty. */
export function annualMfnRate(row:AnnualRow,codeContract:boolean,expanded=false):string|null{
 if(row.issue||!codeContract||!/^0(?:\.0*)?$/.test(row.specific)||!/^0(?:\.0*)?$/.test(row.other))return null;
 let rate:string|null=null;if(row.rateType==='0'&&/^0(?:\.0*)?$/.test(row.adValorem))rate='Free';else if(row.rateType==='7')rate=percent(row.adValorem,expanded);
 if(!rate)return null;if(row.textRate&&row.textRate!==rate)return null;return rate;
}
export function annualForEntry(rows:AnnualRow[],year:number,sourceId:string,entry:{hts:string;date:string},codeKey:{id:string;valid:boolean;quantityUnits?:string[];fieldsSourceId?:string;column2FieldsSourceId?:string}|null):AnnualTariffReference{
 const matches=isStrictIsoDate(entry.date)&&/^\d{10}$/.test(entry.hts)&&Number(entry.date.slice(0,4))===year?rows.filter(r=>r.hts8===entry.hts.slice(0,8)&&(r.issue||r.from<=entry.date&&entry.date<=r.through)):[];
 const row=matches.length===1&&!matches[0].issue?matches[0]:null;const computation=row&&codeKey?.valid&&codeKey.fieldsSourceId?annualQuantityComputation(row,codeKey.quantityUnits??[],codeKey.fieldsSourceId):null;const quantityIssue=row&&!computation&&codeKey?.fieldsSourceId&&['1','2','3','4','5','6'].includes(row.rateType)?'The complete printed rate, numeric fields and quantity codes do not establish one supported exact formula. Printed rate: '+row.textRate.slice(0,160)+'; numeric specific: '+row.specific.slice(0,30)+'; numeric other: '+row.other.slice(0,30)+'; ad valorem fraction: '+row.adValorem.slice(0,30)+'; units: '+row.quantityCodes?.join(', ')+'. Obtain the exact original HTS rate rather than truncating a rate, guessing a unit or choosing an inconsistent field.':undefined;const selectionIssue=matches.some(r=>r.issue)?'A matching source record has invalid or reversed effective dates.':matches.length>1?'Multiple source records cover this legal line and date.':undefined;const result:AnnualTariffReference={codeKeyValidated:codeKey?.valid===true,fieldsSourceId:codeKey?.fieldsSourceId??null,year,sourceId,hts8:entry.hts.slice(0,8),status:row?'matched':matches.length?'ambiguous':'missing',matchedRows:matches.length,row,mfnRate:computation?.expression??(row?annualMfnRate(row,codeKey?.valid===true):null),...(computation?{mfnComputation:computation}:{}),...(quantityIssue?{quantityIssue}:{}),codeKeySourceId:codeKey?.id??null,...(selectionIssue?{selectionIssue}:{}),limitation:'Annual USITC evidence at the 8-digit legal tariff line. It does not validate the declared 10-digit statistical suffix, country eligibility, preferences, trade remedies, exclusions or the complete duty. Source intervals are inclusive and are used only within the captured annual file year. Invalid source dates and overlaps block selection for the affected legal line.'};
 if(row)result.column2Treatment=initialColumn2Treatment(result,codeKey);return result;
}

/** Private calculation projection only. The returned object is never persisted
 * over the original MFN record. Each column retains its own rate and evidence. */
export function annualColumn2Projection(annual:AnnualTariffReference):AnnualTariffReference|null{
 const row=annual.row,c=row?.column2Data,t=annual.column2Treatment;if(!row||!c?.fieldsComplete)return null;
 const {column2Treatment:_column,mfnComputation:_mfn,quantityIssue:_quantity,corroborationIssues:_problems,statisticalTreatment:_stat,statisticalCoverage:_coverage,statisticalIssue:_statIssue,statisticalValueCondition:_value,scheduleCorroboration:_schedule,baseDutyScenario:_scenario,...rest}=annual;
 return{...rest,row:{...row,rateType:c.rateType,adValorem:c.adValorem,specific:c.specific,other:c.other,textRate:row.column2,textRateAvailable:c.textRateAvailable},mfnRate:t?.rate??null,...(t?.computation?{mfnComputation:t.computation}:{}),...(t?.issue?{quantityIssue:t.issue}:{}),...(t?.corroborationIssues?{corroborationIssues:t.corroborationIssues}:{}),...(t?.statisticalTreatment?{statisticalTreatment:t.statisticalTreatment}:{}),...(t?.statisticalCoverage?{statisticalCoverage:t.statisticalCoverage}:{}),...(t?.statisticalIssue?{statisticalIssue:t.statisticalIssue}:{}),...(t?.statisticalValueCondition?{statisticalValueCondition:t.statisticalValueCondition}:{}),...(t?.scheduleCorroboration?{scheduleCorroboration:t.scheduleCorroboration}:{})};
}
function initialColumn2Treatment(annual:AnnualTariffReference,key:{valid:boolean;quantityUnits?:string[];column2FieldsSourceId?:string}|null):AnnualColumn2Treatment{
 const fieldsSourceId=key?.column2FieldsSourceId??null,projected=annualColumn2Projection(annual),row=projected?.row;
 let issue=!row?'The separate Column 2 numeric fields are missing or incomplete.':!key?.valid||!fieldsSourceId?'The retained computation code key or separate Column 2 field definitions are missing or changed.':row.textRateAvailable&&!row.textRate.trim()?'The Column 2 printed-rate field is present but empty.':undefined;
 const computation=!issue&&row?annualQuantityComputation(row,key?.quantityUnits??[],fieldsSourceId!):null,rate=!issue&&row?(computation?.expression??annualMfnRate(row,true,true)):null;
 if(!rate&&!issue)issue='Column 2 method '+row!.rateType+' does not yet establish one complete rate with matching printed text, fields and quantity units. Retained Column 2 text: '+row!.textRate.slice(0,180)+'.';
 return{rate,fieldsSourceId,...(computation?{computation}:{}),...(issue?{issue}:{})};
}
/** A narrow original-column contract: a fully resolved temporary-heading
 * reference printed inline on General does not qualify or alter Column 2.
 * Other legal notes, shared marks and missing/changed geometry remain blocking. */
function generalOnlyTemporaryNote(raw:unknown,rate:ReferenceRate){
 const f=raw as {marker?:unknown;value?:unknown;scope?:unknown;scopeEvidence?:{x?:unknown;y?:unknown;text?:unknown;width?:unknown;markerCell?:{x?:unknown;y?:unknown;text?:unknown}}},p=f?.scopeEvidence;
 if(!f||f.scope!=='general_rate'||typeof f.marker!=='string'||!/^\d+$/.test(f.marker)||typeof f.value!=='string'||!/^See headings? 9902\.\d{2}\.\d{2}(?:(?:, | and |, and )9902\.\d{2}\.\d{2}){0,9}\.$/.test(f.value)||!p||typeof p.x!=='number'||!Number.isFinite(p.x)||p.x<380||p.x>=444||typeof p.y!=='number'||!Number.isFinite(p.y)||p.y<40||p.y>740||typeof p.text!=='string'||p.text.length>150)return null;
 const m=/^(.+?)\s+(\d+\/(?:\d+\/)*)$/.exec(p.text),inline=!!m&&m[1].replace(/\s+/g,' ').trim()===rate.general&&m[2].split('/').includes(f.marker),c=p.markerCell;
 const separate=!m&&p.text===rate.general&&typeof p.width==='number'&&Number.isFinite(p.width)&&p.width>0&&!!c&&typeof c.x==='number'&&Number.isFinite(c.x)&&c.x>=380&&c.x<444&&typeof c.y==='number'&&Number.isFinite(c.y)&&Math.abs(c.y-p.y)<=1&&c.x-(p.x+p.width)>=-1&&c.x-(p.x+p.width)<=15&&typeof c.text==='string'&&/^\d+\/(?:\d+\/)*$/.test(c.text)&&c.text.split('/').includes(f.marker);
 if(!inline&&!separate)return null;
 return{marker:f.marker,value:f.value,scope:'general_rate' as const,scopeEvidence:{x:p.x,y:p.y,text:p.text,...(separate?{width:p.width as number,markerCell:{x:c!.x as number,y:c!.y as number,text:c!.text as string}}:{})}};
}
/** A known 2017 extraction defect left all four Column 2 computation fields
 * empty. Recover from complete agreeing printed rates, never manufacture their
 * missing numeric values or import a different year's formula. */
function recoverPrintedColumn2(annual:AnnualTariffReference,entry:{date:string;hts:string},evidence:AnnualScheduleEvidence[],units:string[],problems:{sourceId:string;reason:string}[],changes:AnnualScheduleChanges[]=[]):AnnualTariffReference{
 const row=annual.row,c=row?.column2Data,t=annual.column2Treatment;
 const restored=changes.flatMap(proof=>proof.restorations.filter(r=>r.hts8===row?.hts8&&r.effectiveOn<=entry.date&&proof.year===annual.year).map(r=>({...r,proof}))),restoration=row&&!row.column2.trim()&&restored.length===1?restored[0]:null;
 if(annual.codeKeyValidated!==true||annual.definitionIssues?.length||annual.year!==2017||annual.status!=='matched'||!row||row.issue||!c?.fieldsComplete||!c.textRateAvailable||[c.rateType,c.adValorem,c.specific,c.other].some(v=>v!=='')||!t?.fieldsSourceId||!annual.codeKeySourceId||row.column2.length>100||!isStrictIsoDate(entry.date)||entry.date.slice(0,4)!=='2017'||entry.hts.slice(0,8)!==row.hts8||!/^\d{10}$/.test(entry.hts)||!isStrictIsoDate(row.from)||!isStrictIsoDate(row.through)||row.from>entry.date||row.through<entry.date)return annual;
 const reject=(reason:string,issues=problems):AnnualTariffReference=>({...annual,column2Treatment:{...t,rate:null,issue:reason,...(issues.length?{corroborationIssues:issues}:{})}});
 if(!row.column2.trim()&&!restoration){const undated=changes.filter(p=>p.year===annual.year&&p.undatedRestorations.includes(row.hts8));return undated.length?reject('The official change record restores this Column 2 rate but gives its effective date as N/A. No legal date or historical rate was inferred.',undated.map(p=>({sourceId:p.sourceId,reason:'The restored Column 2 duty has no established effective date.'}))):annual;}
 if(problems.length)return reject('The pinned original schedule provenance or extraction failed: '+problems.map(p=>p.reason).join(' '));
 const candidates=evidence.filter(e=>e.identity.year===annual.year&&e.identity.chapter===entry.hts.slice(0,2)&&row.from<=e.identity.availableFrom&&e.identity.availableFrom<=row.through);if(!candidates.length)return reject('No matching same-year original schedule is retained within the annual effective interval. The printed annual rate was not applied without its corroborating original.');
 const normalize=(v:string)=>v.replace(/\s+/g,'').toLowerCase(),exciseNotes=new Set<string>();
 let terms:AnnualQuantityComputation['terms']|null=null,currencyRecovered=false;const originals:NonNullable<AnnualTariffReference['scheduleCorroboration']>['originals']=[],sourceIds=new Set<string>(),generalOnlyNotes:NonNullable<NonNullable<AnnualTariffReference['scheduleCorroboration']>['generalOnlyNotes']>=[];
 for(const e of candidates){const r=e.rate,selectedNotes=r?.footnotes.filter(raw=>!generalOnlyTemporaryNote(raw,r))??[];if(e.issue||!r||r.hts!==entry.hts||r.source_id!==e.sourceId||r.projection!=='official-annual-chapter-v1'||r.footnotes.length>20||selectedNotes.some(raw=>{const f=raw as {marker?:unknown;value?:unknown};return typeof f.marker!=='string'||!/^\d+$/.test(f.marker)||typeof f.value!=='string'||!annualDutyFootnoteSupported('<spec> '+f.value);})||r.additional_duties||!r.pdfPage||(!r.column2.trim()&&!restoration)||r.column2.length>100)return reject('Original '+e.sourceId+' does not establish one complete exact-code Column 2 row without unresolved notes or extraction gaps.',[{sourceId:e.sourceId,reason:'Missing, incomplete, conditional or unsupported exact-code original Column 2 row.'}]);
  if(restoration&&!r.column2.trim()){
   if(normalize(r.general)!==normalize(row.textRate)||selectedNotes.length)return reject('The earlier blank Column 2 original does not establish an otherwise agreeing complete tariff row.');
   originals.push({sourceId:e.sourceId,publisherRelease:e.identity.publisherRelease,title:e.identity.description,availableFrom:e.identity.availableFrom,availableBefore:e.identity.availableBefore,page:r.pdfPage,printedRate:'',rateSource:'chapter_column2'});for(const id of[e.sourceId,...annualScheduleSourceIds(e.identity)])sourceIds.add(id);continue;
  }
  if(restoration&&e.identity.publisherRelease!==restoration.proof.publisherRelease)return reject('The restored rate must come from the same verified edition as its dated correction record.');
  for(const raw of r.footnotes){const note=generalOnlyTemporaryNote(raw,r);if(note)generalOnlyNotes.push({...note,sourceId:e.sourceId,page:r.pdfPage});}
  const markers=new Set(selectedNotes.map(raw=>{const f=raw as {marker:string;value:string};exciseNotes.add(f.value);return f.marker;}));
  const stripExcise=(v:string)=>v.replace(/(^|\s)(\d+\/(?:\d+\/)*)(?=\s|$)/g,(all,before,marked)=>marked.split('/').filter(Boolean).every((m:string)=>markers.has(m))?before:all).trim();
  const originalText=stripExcise(r.column2),annualPrintedText=stripExcise(row.column2),annualText=normalize(annualPrintedText),printed=normalize(originalText),missingCent=!annualPrintedText.includes('¢')&&originalText.includes('¢')&&normalize(originalText.replaceAll('¢',''))===annualText;if(!restoration&&printed!==annualText&&!missingCent)return reject('The complete annual Column 2 rate differs from original '+e.sourceId+'. Annual: '+row.column2+'; original: '+r.column2+'. No convenient version was chosen.',[{sourceId:e.sourceId,reason:'The complete original Column 2 text conflicts with the dated annual record.'}]);currencyRecovered ||= missingCent;
  let parsed:AnnualQuantityComputation['terms']|null=null;
  if(/^free$/i.test(originalText))parsed=[{rate:'Free',unit:null}];
  else if(/^\d{1,9}(?:\.\d{1,12})?\s*%$/.test(originalText))parsed=[{rate:originalText.replace(/\s+/g,''),unit:null}];
  else{const fraction=/^(\d{1,9})\s+(\d{1,9})\s*\/\s*(\d{1,9})\s*%$/.exec(originalText);if(fraction&&BigInt(fraction[3])>0n&&BigInt(fraction[2])>0n&&BigInt(fraction[2])<BigInt(fraction[3]))parsed=[{rate:fraction[1]+' '+fraction[2]+'/'+fraction[3]+'%',unit:null}];
   else{const matches=new Map<string,AnnualQuantityComputation['terms']>();for(const method of ['1','2','3','4','5','6']){const parts=printedAnnualTerms(originalText,{...row,rateType:method},units);if(parts)matches.set(JSON.stringify(parts),parts);}if(matches.size===1)parsed=[...matches.values()][0];}
  }
  if(!parsed)return reject('The complete original Column 2 expression needs a supported procedure or unambiguous quantity-unit meaning: '+r.column2+'. No rate, unit or currency was guessed.',[{sourceId:e.sourceId,reason:'The full original expression could not be evaluated with its documented quantity meanings.'}]);if(terms&&JSON.stringify(parsed)!==JSON.stringify(terms))return reject('The applicable original Column 2 formulas conflict; no edition was selected.',[{sourceId:e.sourceId,reason:'Conflicting exact formula terms across the retained originals.'}]);terms=parsed;
  originals.push({sourceId:e.sourceId,publisherRelease:e.identity.publisherRelease,title:e.identity.description,availableFrom:e.identity.availableFrom,availableBefore:e.identity.availableBefore,page:r.pdfPage,printedRate:r.column2,rateSource:'chapter_column2'});for(const id of[e.sourceId,...annualScheduleSourceIds(e.identity)])sourceIds.add(id);
 }
 if(!terms)return annual;if(restoration)for(const id of restoration.proof.sourceIds)sourceIds.add(id);const expression=terms.map(t=>t.rate).join(' + ');if(expression.length>100)return annual;
 return{...annual,column2Treatment:{rate:expression,fieldsSourceId:t.fieldsSourceId,computation:{compiler:'annual-published-formula-v1',method:'complete_published_rate',terms,expression,publishedRate:originals.find(o=>o.printedRate.trim())!.printedRate,fieldsSourceId:t.fieldsSourceId,valueSource:'corroborated_printed_rate'},scheduleCorroboration:{sourceIds:[...sourceIds].sort(),originals,reconciledFields:[],...(generalOnlyNotes.length?{generalOnlyNotes}:{}),...(exciseNotes.size?{excludedExciseNotes:[...exciseNotes]}:{}),recoveredMissingFields:['col2_rate_type_code','col2_ad_val_rate','col2_specific_rate','col2_other_rate',...(restoration?['col2_text_rate']:[])],...(restoration?{restoration:{sourceId:restoration.proof.sourceId,effectiveOn:restoration.effectiveOn,authority:restoration.authority,originalBlank:true as const}}:{}),...(currencyRecovered?{recoveredCurrencyMarker:true}:{}),dateBasis:restoration?'The official 2017 Revision 1 change record expressly restores this Column 2 duty effective '+restoration.effectiveOn+' under '+restoration.authority+'. The complete rate comes from that same retained corrected edition; earlier annual and Basic blanks remain blank, never zero. Declared classification, legal origin and entry scope remain assumptions.':'The dated 2017 annual record and every applicable retained same-year original agree on the complete Column 2 rate. Missing method/numeric fields remain blank. Any recovered cent glyph is established by the original printed rate, never guessed from a number. Original availability does not replace the annual legal effective interval; classification, legal origin and scope remain declared assumptions.'}}};
}
export function corroborateAnnualColumn2(annual:AnnualTariffReference,entry:{date:string;hts:string},evidence:AnnualScheduleEvidence[],units:string[],problems:{sourceId:string;reason:string}[]=[],changes:AnnualScheduleChanges[]=[]):AnnualTariffReference{
 if(annual.codeKeyValidated!==true||annual.definitionIssues?.length)return annual;
 const recovered=recoverPrintedColumn2(annual,entry,evidence,units,problems,changes);if(recovered!==annual)return recovered;
 const t=annual.column2Treatment,p=annualColumn2Projection(annual);if(!t?.fieldsSourceId||!p?.row||!annual.codeKeySourceId)return annual;
 let updated=p.row.rateType==='T'||p.row.rateType==='0'&&evidence.some(e=>e.statisticalPrefix)?corroborateAnnualStatisticalRate({...p,mfnRate:null},entry,evidence,t.fieldsSourceId,problems.map(p=>p.reason),'column2'):corroborateAnnualRate(p,entry,evidence,units,t.fieldsSourceId,problems.map(p=>p.reason),'column2');
 if(p.row.rateType==='0'&&entry.hts.startsWith('91')&&!evidence.some(e=>e.statisticalPrefix)&&(problems.length||!evidence.length||evidence.some(e=>!e.statisticalContract||!e.rate||e.rate.column2!=='Free'||e.rate.footnotes.length)))updated={...p,mfnRate:null,quantityIssue:'The complete Column 2 statistical reporting contract could not be established; an annual Free sentinel was not used.'};
 const current=evidence.filter(e=>e.identity.availableFrom<=entry.date&&entry.date<e.identity.availableBefore),bad=current.length===1&&current[0].statisticalContract&&current[0].statisticalPrefix&&!current[0].statisticalSuffixes?.includes(entry.hts.slice(8))?current[0]:null;
 return{...annual,column2Treatment:{rate:updated.mfnRate,fieldsSourceId:t.fieldsSourceId,...(updated.mfnComputation?{computation:updated.mfnComputation}:{}),...(!updated.mfnRate?{issue:updated.quantityIssue??t.issue}:{}),...(updated.statisticalTreatment?{statisticalTreatment:updated.statisticalTreatment}:{}),...(updated.statisticalCoverage?{statisticalCoverage:updated.statisticalCoverage}:{}),...(updated.statisticalValueCondition?{statisticalValueCondition:updated.statisticalValueCondition}:{}),...(updated.scheduleCorroboration?{scheduleCorroboration:updated.scheduleCorroboration}:{}),...(problems.length?{corroborationIssues:problems}:{}),...(bad?{statisticalIssue:{reason:'Declared statistical suffix '+entry.hts.slice(8)+' is absent from the contemporaneous reporting table for Column 2 treatment. No replacement was guessed.',sourceIds:[bad.sourceId,...annualScheduleSourceIds(bad.identity)],suffixes:bad.statisticalSuffixes!}}:{})}};
}

/** Statistical annotations change reporting codes, not the legal-line rate.
 * Check each actual published code as rate evidence without rewriting its HTS
 * to resemble the shipment. The explicit change record binds the entry's code
 * to its date; product classification itself remains a declared fact. */
export function corroborateAnnualDatedCodes(annual:AnnualTariffReference,entry:{date:string;hts:string},evidence:AnnualScheduleEvidence[],units:string[],changes:AnnualScheduleChanges[],problems:{sourceId:string;reason:string}[]=[],column:'general'|'column2'='general'):AnnualTariffReference {
 if(annual.year!==2017||!['29181700','29313900'].includes(entry.hts.slice(0,8)))return annual;
 const matches=changes.flatMap(proof=>proof.annotations.filter(c=>c.hts8===entry.hts.slice(0,8)&&proof.year===annual.year).map(change=>({proof,change}))),one=matches.length===1?matches[0]:null;
 const sourceIds=[...new Set([...(one?.proof.sourceIds??[]),...evidence.flatMap(e=>[e.sourceId,...annualScheduleSourceIds(e.identity)])])];
 const fail=(reason:string,codeIssue=false):AnnualTariffReference=>{
  const issue={reason,sourceIds,suffixes:one?(entry.date<one.change.effectiveOn?one.change.previous:one.change.established):[]};
  return column==='column2'?{...annual,...(codeIssue?{statisticalIssue:issue}:{}),column2Treatment:{...annual.column2Treatment!,fieldsSourceId:annual.column2Treatment?.fieldsSourceId??null,rate:null,issue:reason,...(codeIssue?{statisticalIssue:issue}:{})}}:{...annual,mfnRate:null,mfnComputation:undefined,quantityIssue:reason,...(codeIssue?{statisticalIssue:issue}:{})};
 };
 const row=annual.row,fields=column==='column2'?annual.column2Treatment?.fieldsSourceId:annual.fieldsSourceId;
 if(!one||problems.length||annual.status!=='matched'||annual.codeKeyValidated!==true||annual.definitionIssues?.length||!row||row.issue||!fields||!annual.codeKeySourceId||!isStrictIsoDate(entry.date)||entry.date.slice(0,4)!=='2017'||!/^\d{10}$/.test(entry.hts)||row.hts8!==entry.hts.slice(0,8)||row.from>entry.date||row.through<entry.date)return fail('The complete dated statistical-change contract and original legal-line evidence are required before this historical code can be used.',true);
 const {proof,change}=one,beforeChange=entry.date<change.effectiveOn,allowed=beforeChange?change.previous:change.established;
 if(!allowed.includes(entry.hts.slice(8)))return fail('The declared statistical suffix '+entry.hts.slice(8)+' is not valid for this entry date under the official '+change.effectiveOn+' annotation. Published suffixes for this period: '+allowed.join(', ')+'. Confirm the historical classification; no replacement code was guessed.',true);
 const relevant=evidence.filter(e=>e.identity.year===2017&&e.identity.chapter==='29');
 if(relevant.length!==2||new Set(relevant.map(e=>e.sourceId)).size!==2||relevant.filter(e=>e.identity.publisherRelease==='basicCorrections2').length!==1||relevant.filter(e=>e.identity.publisherRelease===proof.publisherRelease).length!==1)return fail('Both original Basic and Revision 1 chapter tables are required to verify this dated reporting transition.',true);
 let computed:AnnualTariffReference|null=null,computation:AnnualQuantityComputation|null=null,expression:string|null=null;
 const originals:NonNullable<AnnualTariffReference['scheduleCorroboration']>['originals']=[];
 for(const e of relevant){
  const suffixes=e.identity.publisherRelease===proof.publisherRelease?change.established:change.previous,expectedCodes=suffixes.map(s=>row.hts8+s),rates=e.annotationRates??[];
  if(e.issue||rates.length!==expectedCodes.length||new Set(rates.map(r=>r.hts)).size!==expectedCodes.length||expectedCodes.some(code=>!rates.some(r=>r.hts===code)))return fail('An original edition is missing one or more explicitly published codes for the dated annotation; no suffix or tariff row was manufactured.',true);
  let original:NonNullable<AnnualTariffReference['scheduleCorroboration']>['originals'][number]|null=null;
  for(const rate of rates){
   if(rate.source_id!==e.sourceId||rate.projection!=='official-annual-chapter-v1'||!rate.pdfPage||rate.footnotes.length||rate.additional_duties)return fail('An annotated-code original has incomplete provenance or unresolved conditions; a legal-line rate was not inferred.');
   // This is a rate-only observation at the actual code printed in that source,
   // not a claim that its suffix was reportable on the shipment's entry date.
   const observation={...e,rate,annotationRates:undefined},published={date:entry.date,hts:rate.hts};
   const result=column==='column2'?corroborateAnnualColumn2(annual,published,[observation],units):corroborateAnnualRate({...annual,mfnRate:null},published,[observation],units,fields);
   const rateResult=column==='column2'?annualColumn2Projection(result):result,formula=rateResult?.mfnComputation,corroboration=rateResult?.scheduleCorroboration;
   if(!rateResult?.mfnRate||!formula||!corroboration||expression!==null&&expression!==rateResult.mfnRate||computation&&JSON.stringify(computation.terms)!==JSON.stringify(formula.terms))return fail('The complete annual legal-line rate does not agree across every published old and new reporting code. No convenient edition was chosen.');
   if(original&&(original.page!==rate.pdfPage||original.printedRate!==rate[column]))return fail('The complete annotated legal-line rate spans inconsistent original rows and requires separate review.');
   expression=rateResult.mfnRate;computation=formula;computed=result;
   original={...corroboration.originals[0],publishedCodes:expectedCodes};
  }
  if(!original)return fail('The dated annotation has no complete original rate observation.');originals.push(original);
 }
 if(!computed||!computation||!expression)return fail('The dated annotation has no complete agreeing legal-line formula.');
 const selected=column==='column2'?computed.column2Treatment!.scheduleCorroboration!:computed.scheduleCorroboration!,annotation={sourceId:proof.sourceId,effectiveOn:change.effectiveOn,from:beforeChange?'2017-01-01':change.effectiveOn,before:beforeChange?change.effectiveOn:'2018-01-01',previous:change.previous,established:change.established,selected:entry.hts,authority:change.authority};
 const corroboration={...selected,sourceIds,originals,annotation,dateBasis:'The official 2017 change record establishes reporting annotations effective '+change.effectiveOn+'. The declared exact code is published for this side of that date. Every explicitly published old/new code in the Basic and Revision 1 originals agrees with the complete annual legal-line rate. Original codes are retained as rate evidence, not relabeled as the shipment code. Product classification and lawful entry scope remain declared assumptions.'};
 return column==='column2'?{...annual,column2Treatment:{...computed.column2Treatment!,scheduleCorroboration:corroboration}}:{...computed,scheduleCorroboration:corroboration};
}


export type RelatedArticleRateProof={hts:string;column:'general'|'column2';sourceIds:string[];originals:{sourceId:string;page:number;printedRate:string}[];from:string;before:string;expression:string};
/** An exact parent code and complete agreeing originals are mandatory, including
 * when annual numeric fields already provide an ordinary percentage. The source
 * is not rewritten to match a declaration; compound parent charges stay open. */
export function proveRelatedArticleRate(annual:AnnualTariffReference,entry:{date:string;hts:string},evidence:AnnualScheduleEvidence[],column:'general'|'column2',problems:{sourceId:string;reason:string}[]=[]):RelatedArticleRateProof|null {
 const projected=column==='column2'?annualColumn2Projection(annual):annual,r=projected?.row,rate=projected?.mfnRate;
 if(!r||annual.status!=='matched'||!annual.codeKeyValidated||annual.definitionIssues?.length||projected?.statisticalIssue||projected?.statisticalTreatment||r.issue||!rate||r.from>entry.date||r.through<entry.date||!isStrictIsoDate(entry.date)||entry.date.slice(0,4)!==String(annual.year)||entry.hts.slice(0,8)!==r.hts8||!/^\d{10}$/.test(entry.hts)||!annualDutyFootnoteSupported(r.footnote)||!['','No'].includes(r.additional)||problems.length||!evidence.length||evidence.length>8)return null;
 const normalize=(v:string)=>v.trim().toLowerCase().replace(/\s+/g,'');
 if(!/^(?:Free|\d{1,9}(?:\.\d{1,12})?%)$/i.test(rate))return null;
 const originals:RelatedArticleRateProof['originals']=[],ids=new Set<string>();
 for(const e of evidence){const q=e.rate;if(e.issue||e.identity.year!==annual.year||e.identity.chapter!==entry.hts.slice(0,2)||!q||q.hts!==entry.hts||q.source_id!==e.sourceId||q.projection!=='official-annual-chapter-v1'||!q.pdfPage||q.footnotes.length||q.additional_duties||normalize(q[column])!==normalize(rate))return null;originals.push({sourceId:e.sourceId,page:q.pdfPage,printedRate:q[column]});for(const id of[e.sourceId,...annualScheduleSourceIds(e.identity)])ids.add(id);}
 const end=new Date(r.through+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+1);const from=r.from>`${annual.year}-01-01`?r.from:`${annual.year}-01-01`,before=end.toISOString().slice(0,10)<`${annual.year+1}-01-01`?end.toISOString().slice(0,10):`${annual.year+1}-01-01`;
 if(entry.date<from||entry.date>=before)return null;
 return {hts:entry.hts,column,sourceIds:[...ids].sort(),originals,from,before,expression:rate};
}

export function proveRelatedArticleInstruction(annual:AnnualTariffReference,entry:{date:string;hts:string},evidence:AnnualScheduleEvidence[],column:'general'|'column2',problems:{sourceId:string;reason:string}[]=[]):{hts:string;column:'general'|'column2';sourceIds:string[];wording:string;from:string;before:string}|null {
 const row=annual.row,expected=entry.hts.startsWith('90159001')?'The rate applicable to the article of which it is a part or accessory':'The rate applicable to the article of which it is an accessory',printed=column==='column2'?row?.column2:row?.textRate;
 if(!row||annual.status!=='matched'||!annual.codeKeyValidated||annual.definitionIssues?.length||row.issue||printed!==expected||entry.hts.slice(0,8)!==row.hts8||!isStrictIsoDate(entry.date)||entry.date.slice(0,4)!==String(annual.year)||annual.year<2000||annual.year>2017||row.from>entry.date||row.through<entry.date||!annualDutyFootnoteSupported(row.footnote)||!['','No'].includes(row.additional)||problems.length||!evidence.length||evidence.length>8)return null;
 const ids=new Set<string>();for(const e of evidence){const q=e.rate;if(e.issue||e.identity.year!==annual.year||e.identity.chapter!==entry.hts.slice(0,2)||!q||q.hts!==entry.hts||q.source_id!==e.sourceId||q.projection!=='official-annual-chapter-v1'||!q.pdfPage||q.footnotes.length||q.additional_duties||q[column]!==expected)return null;for(const id of[e.sourceId,...annualScheduleSourceIds(e.identity)])ids.add(id);}
 const end=new Date(row.through+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+1);const from=row.from>`${annual.year}-01-01`?row.from:`${annual.year}-01-01`,before=end.toISOString().slice(0,10)<`${annual.year+1}-01-01`?end.toISOString().slice(0,10):`${annual.year+1}-01-01`;
 return {hts:entry.hts,column,sourceIds:[...ids].sort(),wording:expected,from,before};
}
