import {compileExclusionHistory} from './exclusion-history';
import type {ExclusionWindow} from './section301-chart';
import {isStrictIsoDate} from '@/lib/tariff/date';

export const CHAPTER99_ACTIONS=['2023-28770','2024-11904','2018-05477','2018-05478'] as const;
export type Chapter99Action={id:string;documentNumber:string;text:string};
export type HistoricalExclusion={heading:string;target:string;hts:string;scope:string;description:string;from:string;before:string;boundaryDays:string[];sourceIds:string[]};
export type HistoricalMetal={heading:string;rate:string;legalEffectiveOn:string;prefixes:string[];except:string[];sourceIds:string[];requiresRussianAluminumClearance:boolean};
export type HistoricalChapter99={compiler:'historical-chapter99-v1'|'historical-chapter99-v2';from:string;before:string;exclusions:HistoricalExclusion[];metals:HistoricalMetal[];unsupportedScopes?:{heading:string;scope:string;hts:string[];reason:string}[];coverage?:{parsedDefinitions:number;supportedDefinitions:number;skippedDefinitions:number};issues?:string[];unmodeledMetalCodes?:string[]};

/** Syntax alone never establishes applicability. Keep the uploaded field in raw. */
export function chapter99Code(raw:string):string|null{
 if(!/^[\d.\s]+$/.test(raw))return null;
 const code=raw.replace(/[.\s]/g,'');return /^99\d{6}$/.test(code)?`${code.slice(0,4)}.${code.slice(4,6)}.${code.slice(6)}`:null;
}
export function declaredChapter99(raw:string){
 const codes:string[]=[],errors:string[]=[];
 for(const token of raw.split(/[;,|\n]/).map(s=>s.trim()).filter(Boolean)){
  const code=chapter99Code(token);if(!code)errors.push(`Invalid Chapter 99 code: ${token.slice(0,80)}. Use an eight-digit 99xx.xx.xx code and separate codes with semicolons.`);else if(!codes.includes(code))codes.push(code);
 }
 if(codes.length>30)errors.push('Use no more than 30 distinct Chapter 99 codes per entry.');
 return {codes:codes.slice(0,30),errors};
}
/** Only these printed, country-exclusive headings have a negative contract.
 * A footnote reference is not itself an applicable duty. Changed wording fails
 * closed; Russian smelt/cast aluminum remains a separate shipment condition. */
export function chapter99NonApplicability(rows:{hts:string;description:string}[],origin:string){
 if(!/^[A-Z]{2}$/.test(origin))return [];
 return rows.flatMap(row=>{
  const code=chapter99Code(row.hts),description=row.description.replace(/\s+/g,' ').trim();
  // Only complete, plain China-origin provisions qualify. Conditional crane
  // rules that also cover Chinese components/ownership are deliberately outside
  // this grammar; a substring mentioning China never proves non-applicability.
  const plainChina=/^(?:Except as provided in heading 9903\.91\.10, )?Effective with respect to entries on or after ([A-Z][a-z]+ \d{1,2}, \d{4})(?:, and before ([A-Z][a-z]+ \d{1,2}, \d{4}))?, articles the product of China, as provided for in subdivision \(([a-z])\) of U.S. note 31 to this subchapter$/.exec(description),parts:Record<string,string>={'9903.91.01':'b','9903.91.02':'c','9903.91.03':'d','9903.91.04':'e','9903.91.05':'f','9903.91.06':'g','9903.91.07':'h','9903.91.08':'i','9903.91.11':'j','9903.91.12':'k'};
  const validDate=(raw:string)=>{const m=/^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/.exec(raw),month=m?['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(m[1])+1:0;return !!m&&month>0&&isStrictIsoDate(`${m[3]}-${String(month).padStart(2,'0')}-${m[2].padStart(2,'0')}`);};
  if(code&&origin!=='CN'&&plainChina&&parts[code]===plainChina[3]&&validDate(plainChina[1])&&(!plainChina[2]||validDate(plainChina[2]))&&(!description.startsWith('Except')||code==='9903.91.03'))return[{heading:code,reason:`The complete dated heading is expressly limited to products of China; the declared or reviewed legal origin is ${origin}. This does not establish legal origin, a China rate or a separate exception.`}];
  const list3Exceptions=['33','34','36','37','38','40','46','48','56','64','66','67','69'].map(n=>'9903.88.'+n),plainList3='Except as provided in headings '+list3Exceptions.slice(0,-1).join(', ')+', or '+list3Exceptions.at(-1)+', articles the product of China, as provided for in U.S. note 20(g) to this subchapter and as provided for in the subheadings enumerated in U.S. note 20(g)';
  if(code==='9903.88.04'&&origin!=='CN'&&description===plainList3)return[{heading:code,reason:'The complete dated heading20(g) is expressly limited to products of China; the declared or reviewed legal origin is '+origin+'. This does not establish legal origin, a China rate or exclusion qualification.'}];
  const pair=code==='9903.90.08'?['a','b']:code==='9903.90.09'?['c','d']:null;
  if(origin==='RU')return [];
  if(!pair)return [];
  const expected=`Articles the product of the Russian Federation, as provided for in U.S. note 30(${pair[0]}) to this subchapter and as provided for in the subheadings enumerated in U.S. note 30(${pair[1]}) to this subchapter`;
  return description===expected?[{heading:code!,reason:`The dated published heading is limited to products of the Russian Federation; the reviewed or declared legal origin is ${origin}. This does not establish aluminum smelt/cast origin.`}]:[];
 });
}
const normalized=(s:string)=>s.replace(/[“”]/g,'"').replace(/\s+/g,' ').trim();
function date(s:string){const d=new Date(s+' UTC');if(!Number.isFinite(d.getTime()))return null;const iso=d.toISOString().slice(0,10);return isStrictIsoDate(iso)?iso:null;}
function tomorrow(s:string){const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);}

/** Establish the heading's printed date window, not the source capture date. */
function exclusionWindow(notes:string,heading:string){
 const at=notes.lastIndexOf(heading+' The duty provided in the applicable subheading');if(at<0)return null;
 const start=notes.lastIndexOf('Effective with respect to entries on or after ',at);if(start<0||at-start>1100)return null;
 const row=notes.slice(start,at),m=/entries on or after ([A-Za-z]+ \d{1,2}, \d{4}),? and (before|through) ([A-Za-z]+ \d{1,2}, \d{4}),? articles the product of China/.exec(row);
 if(!m||!row.includes('each covered by an exclusion granted by the U.S. Trade Representative'))return null;
 const from=date(m[1]),end=date(m[3]);if(!from||!end)return null;
 return {from,before:m[2]==='through'?tomorrow(end):end};
}

/** Dated exclusions are candidate product scopes, never inferred qualification.
 * Descriptions with their own historical-code transitions are deliberately not
 * reduced to unrestricted code membership. The original remains downloadable. */
function exclusions(notes:string,noteId:string,actions:Chapter99Action[],ledger:{parsedDefinitions:number;supportedDefinitions:number;skippedDefinitions:number;unsupportedScopes:NonNullable<HistoricalChapter99["unsupportedScopes"]>;issues:string[]}):HistoricalExclusion[]{
 const result:HistoricalExclusion[]=[];
 for(const config of [{heading:'9903.88.67',part:'ttt',next:'uuu'},{heading:'9903.88.68',part:'uuu',next:'vvv'},{heading:'9903.88.69',part:'vvv',next:'www'}]){
  const published=exclusionWindow(notes,config.heading);if(!published)continue;
  const extension=actions.find(a=>a.documentNumber==='2023-28770'),renewal=actions.find(a=>a.documentNumber==='2024-11904');
  const windows:{from:string;before:string;action:Chapter99Action;boundaries:string[]}[]=[];
  if(config.part!=='vvv'&&extension&&extension.text.includes(config.heading)&&/January 1,? 2024/.test(extension.text)&&/May 31,? 2024/.test(extension.text))windows.push({from:'2024-01-01',before:'2024-06-01',action:extension,boundaries:['2024-01-01','2024-05-31']});
  if(renewal&&renewal.text.includes(config.heading)&&/June 14,? 2024/.test(renewal.text)&&/June 15,? 2024/.test(renewal.text))windows.push(config.part!=='vvv'?{from:'2024-06-01',before:'2024-06-15',action:renewal,boundaries:['2024-06-01','2024-06-14']}:{from:'2024-06-15',before:'2025-01-01',action:renewal,boundaries:['2024-06-15']});
  if(!windows.length){ledger.issues.push(`${config.heading}: the original dated extension instrument is missing or changed; no exclusion was activated.`);continue;}
  const begin=notes.indexOf(`(${config.part}) (i) The U.S. Trade Representative`);if(begin<0)continue;
  const next=notes.indexOf(`(${config.next}) (i)`,begin+1),note21=notes.indexOf('(21)(a) Except as provided in notes 21(',begin+1);
  const end=[next,note21,begin+200000].filter(n=>n>begin).sort((a,b)=>a-b)[0];
  const section=notes.slice(begin,end);
  const starts=[...section.matchAll(/\((i|ii|iii|iv)\) The U.S. Trade Representative determined to establish a process by which particular products classified in heading (9903\.88\.\d{2})/g)];
  for(const [i,start]of starts.entries()){
   const segment=section.slice(start.index,starts[i+1]?.index??section.length),introEnd=segment.indexOf('(1) ');if(introEnd<0)continue;
   const intro=segment.slice(0,introEnd),target=start[2];
   if(!intro.includes(`as provided in heading ${config.heading}, the additional duties provided for in heading ${target} shall not apply to the following particular products`))continue;
   const items=[...segment.slice(introEnd).matchAll(/\((\d{1,3})\) ([\s\S]*?)(?=\(\d{1,3}\) |$)/g)];
   if(!items.length||items.length>500||items.some((m,j)=>Number(m[1])!==j+1)){ledger.issues.push(`${config.heading} note 20(${config.part})(${start[1]}): numbered product definitions need parser review; no scope in this group was activated.`);continue;}
   for(const item of items){
    const description=item[2].trim(),codes=[...new Set(description.match(/\b\d{4}\.\d{2}\.\d{4}\b/g)??[])];ledger.parsedDefinitions++;
    if(description.length>4000||/\b(?:prior to|effective|through [A-Za-z]+ \d|on or after|on or before)\b/i.test(description)||!codes.length){ledger.skippedDefinitions++;ledger.unsupportedScopes.push({heading:config.heading,scope:`20(${config.part})(${start[1]})(${item[1]})`,hts:codes.map(c=>c.replaceAll('.','')),reason:'This definition has a dated classification transition or unsupported layout; its original needs review before use.'});continue;}
    ledger.supportedDefinitions++;
    for(const window of windows){const from=[published.from,window.from].sort().at(-1)!,before=[published.before,window.before].sort()[0];if(from>=before)continue;
     for(const code of codes)result.push({heading:config.heading,target,hts:code.replaceAll('.',''),scope:`20(${config.part})(${start[1]})(${item[1]})`,description,from,before,boundaryDays:window.boundaries,sourceIds:[noteId,window.action.id]});
    }
   }
  }
 }
 return result;
}

const PRIMARY_METAL_SPECS=[
  {note:'16',heading:'9903.80.01',rate:'25%',action:'2018-05478',end:'(c) The Secretary of Commerce',prefixes:['7206','7207','7208','7209','7210','7211','7212','7213','7214','7215','7216','7217','7218','7219','7220','7221','7222','7223','7224','7225','7226','7227','7228','7229','73011000','730210','73024000','73029000','7304','7305','7306'],except:['72166100','72166900','72169100'],kind:'iron or steel'},
  {note:'19',heading:'9903.85.01',rate:'10%',action:'2018-05477',end:'(c) The Secretary of Commerce',prefixes:['7601','7604','7605','7606','7607','7608','7609','76169951'],except:[],kind:'aluminum'},
 ];
/** Conservative scope guard: absence of a proved metal contract must not turn
 * known primary-metal goods into an ordinary base-plus-301 calculation. */
export function knownHistoricalMetalCodes(notes:string){
 const codes=new Set<string>();for(const n of [16,19]){const start=new RegExp(`(?:^| )${n}\\. ?\\(a\\)`).exec(notes);if(!start)continue;const tail=notes.slice(start.index),end=new RegExp(`(?:^| )(?:${Array.from({length:20-n},(_,i)=>n+i+1).join('|')})\\. ?(?=[A-Z(])`).exec(tail),part=tail.slice(0,end?.index??100000);if(part.length>100000)continue;for(const code of part.match(/\b\d{4}\.\d{2}(?:\.\d{2}(?:\d{2})?)?|\b(?:72|73|74|76)\d{2}\b/g)??[]){const digits=code.replaceAll('.','');if(!digits.startsWith('99'))codes.add(digits);}}return [...codes];
}
export function primaryMetalHeadings(hts:string){return PRIMARY_METAL_SPECS.filter(s=>s.prefixes.some(p=>hts.startsWith(p))&&!s.except.some(p=>hts.startsWith(p))).map(s=>s.heading);}

/** The complete primary-metal list is checked, rather than pulling every code
 * mentioned in a note. Derivatives, quotas and exclusions need separate support.
 * China-only estimates also require explicit non-Russian aluminum evidence. */
function metals(notes:string,noteId:string,actions:Chapter99Action[]):HistoricalMetal[]{
 const result:HistoricalMetal[]=[];

 for(const spec of PRIMARY_METAL_SPECS){
  const action=actions.find(a=>a.documentNumber===spec.action);if(!action||!action.text.includes(spec.heading)||!action.text.includes(spec.rate.replace('%',' percent'))||!/March 23,? 2018/.test(action.text))continue;
  const start=notes.indexOf(`(b) The rates of duty set forth in heading ${spec.heading}`),end=notes.indexOf(spec.end,start);if(start<0||end<start||end-start>5000)continue;
  const list=notes.slice(start,end);const found=[...new Set((list.match(/\b(?:72\d{2}|73\d{2}|76\d{2})(?:\.\d{2}(?:\.\d{2})?)?\b/g)??[]).map(c=>c.replaceAll('.','')))];
  const expected=[...spec.prefixes,...spec.except];if(found.length!==expected.length||expected.some(c=>!found.includes(c)))continue;
  if(!list.includes(`apply to all imported products of ${spec.kind} classifiable in the provisions enumerated in this subdivision`)||!list.includes('all its subordinate provisions (both legal and statistical) is covered'))continue;
  const at=notes.lastIndexOf(spec.heading+' The duty provided in the applicable subheading + '+spec.rate);if(at<0)continue;
  const rowStart=notes.lastIndexOf('Articles of '+(spec.note==='16'?'iron or steel':'aluminum'),at),modernStart=notes.lastIndexOf(spec.note==='16'?'Except for derivative iron or steel products':'Except for products described in heading',at),legacyStart=notes.lastIndexOf('Products of '+(spec.note==='16'?'iron or steel':'aluminum')+' provided',at),startRow=Math.max(rowStart,modernStart,legacyStart),row=notes.slice(startRow,at);
  if(startRow<0||row.length>2000||row.includes('of China')||!row.includes('exclusions that may be determined and announced by the Department of Commerce'))continue;
  const noteStart=notes.indexOf(spec.note+'. (a)'),ordinary=notes.slice(noteStart,start);
  if(noteStart<0||!ordinary.includes(`any additional duty prescribed in any provision of this subchapter or subchapter IV of chapter 99 shall be imposed in addition to the duty in heading ${spec.heading}`))continue;
  result.push({heading:spec.heading,rate:spec.rate,legalEffectiveOn:'2018-03-23',prefixes:spec.prefixes,except:spec.except,sourceIds:[noteId,action.id],requiresRussianAluminumClearance:spec.note==='19'});
 }
 return result;
}
export function proveHistoricalChapter99(input:{release:string;from:string;before:string;noteId:string;notes:string;actions:Chapter99Action[];exclusionWindows?:ExclusionWindow[]}):HistoricalChapter99|null{
 if(input.exclusionWindows){
  if(!/^20(?:1[89]|2[0-6])(?:HTS|BasicEdition)/.test(input.release)||input.from<'2018-01-01'||input.before>'2027-01-01'||input.before<=input.from)return null;
  const notes=normalized(input.notes),ledger={parsedDefinitions:0,supportedDefinitions:0,skippedDefinitions:0,unsupportedScopes:[] as NonNullable<HistoricalChapter99['unsupportedScopes']>,issues:[] as string[]};
  const excluded=compileExclusionHistory(notes,input.noteId,input.exclusionWindows,ledger),metal=input.before<='2025-03-12'?metals(notes,input.noteId,input.actions).map(m=>({...m,requiresRussianAluminumClearance:m.requiresRussianAluminumClearance&&input.before>'2023-03-10'})):[];
  return {compiler:'historical-chapter99-v2',unmodeledMetalCodes:knownHistoricalMetalCodes(notes),from:input.from,before:input.before,exclusions:excluded,metals:metal,coverage:{parsedDefinitions:ledger.parsedDefinitions,supportedDefinitions:ledger.supportedDefinitions,skippedDefinitions:ledger.skippedDefinitions},unsupportedScopes:ledger.unsupportedScopes,issues:ledger.issues};
 }
 if(!/^2024(?:HTS|BasicEdition)/.test(input.release)||input.from>='2025-01-01'||input.before>'2025-01-01'||input.before<=input.from)return null;
 const notes=normalized(input.notes),ledger={parsedDefinitions:0,supportedDefinitions:0,skippedDefinitions:0,unsupportedScopes:[] as NonNullable<HistoricalChapter99["unsupportedScopes"]>,issues:[] as string[]};const excluded=exclusions(notes,input.noteId,input.actions,ledger),metal=metals(notes,input.noteId,input.actions);
 return excluded.length||metal.length?{compiler:'historical-chapter99-v1',from:input.from,before:input.before,exclusions:excluded,metals:metal,coverage:{parsedDefinitions:ledger.parsedDefinitions,supportedDefinitions:ledger.supportedDefinitions,skippedDefinitions:ledger.skippedDefinitions},unsupportedScopes:ledger.unsupportedScopes,issues:ledger.issues}:null;
}
