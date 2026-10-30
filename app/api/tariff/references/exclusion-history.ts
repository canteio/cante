import {isStrictIsoDate} from '@/lib/tariff/date';
import type {ExclusionWindow} from './section301-chart';
import type {HistoricalExclusion} from './chapter99-contract';

const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
export function legalTextDate(raw:string){
 const m=/^([A-Za-z]+) (\d{1,2}),? (\d{4})$/.exec(raw.trim());if(!m)return null;
 const month=months.indexOf(m[1]);if(month<0)return null;
 const iso=`${m[3]}-${String(month+1).padStart(2,'0')}-${m[2].padStart(2,'0')}`;return isStrictIsoDate(iso)?iso:null;
}
const nextDay=(s:string)=>new Date(Date.parse(s+'T00:00:00Z')+86400000).toISOString().slice(0,10);
const dateText='[A-Za-z]+ \\d{1,2},? \\d{4}';
type CodeInterval={hts:string;from:string;before:string};

/** Interpret only explicit statistical-code date annotations. Product dimensions,
 * use, value, performance and origin remain a reviewer's evidence decision. */
export function exclusionCodeIntervals(description:string):CodeInterval[]|null{
 const codes=[...new Set(description.match(/\b\d{4}\.\d{2}\.\d{4}\b/g)??[])];
 if(!codes.length||description.length>6000)return null;
 if(!/\b(?:prior to|effective|through [A-Za-z]+ \d|on or after|on or before)\b/i.test(description))return codes.map(c=>({hts:c.replaceAll('.',''),from:'1900-01-01',before:'2100-01-01'}));
 const annotation=/\((described in statistical reporting numbers? [^()]*)\)/g;
 const groups=[...description.matchAll(annotation)];
 const remainder=description.replace(annotation,'');
 if(!groups.length||/\b(?:prior to|effective|on or after|on or before)\b/i.test(remainder))return null;
 const result:CodeInterval[]=[];
 for(const group of groups)for(const part of group[1].split(';').map(s=>s.trim())){
  const m=/^described in statistical reporting numbers? ((?:\d{4}\.\d{2}\.\d{4}(?:,? (?:or |and )?)?)+)(.*)$/.exec(part);if(!m)return null;
  const observed=m[1].match(/\d{4}\.\d{2}\.\d{4}/g)??[],tail=m[2].trim();let from='1900-01-01',before='2100-01-01';
  if(tail){const prior=new RegExp(`^prior to (${dateText})$`).exec(tail),effective=new RegExp(`^effective (${dateText})(?: through (${dateText}))?$`).exec(tail);
   if(prior){const d=legalTextDate(prior[1]);if(!d)return null;before=d;}
   else if(effective){const d=legalTextDate(effective[1]),end=effective[2]?legalTextDate(effective[2]):null;if(!d||effective[2]&&!end)return null;from=d;if(end)before=nextDay(end);}
   else return null;
  }
  if(from>=before)return null;for(const code of observed)result.push({hts:code.replaceAll('.',''),from,before});
 }
 // Every mentioned exact code must be accounted for; no unqualified fallback.
 return codes.every(c=>result.some(r=>r.hts===c.replaceAll('.','')))?result:null;
}

function headingWindow(notes:string,heading:string){
 const at=notes.lastIndexOf(heading+' The duty provided in the applicable subheading');if(at<0)return null;
 const start=notes.lastIndexOf('Effective with respect to entries on or after ',at);if(start<0||at-start>1600)return null;
 const row=notes.slice(start,at);if(/9903\.\d{2}\.\d{2} The duty/.test(row))return null;const m=new RegExp(`Effective with respect to entries on or after (${dateText}),? and (before|through) (${dateText}),? articles the product of China`).exec(row);
 if(!m||!row.includes('U.S. note 20('))return null;
 const from=legalTextDate(m[1]),end=legalTextDate(m[3]);if(!from||!end)return null;
 return {from,before:m[2]==='through'?nextDay(end):end,boundaries:[from,end]};
}
/** Explicitly numbered, explicitly dated renewals only. No-date cross-references
 * and 'some exclusions extended' prose never extend an entire old heading. */
export function numberedExclusionExtension(intro:string){
 const note=/\[Compiler['’]s note:[^\]]*\]/i.exec(intro)?.[0];if(!note)return null;
 const match=/exclusions in subdivisions ((?:\(\d{1,3}\)|[ ,]|and)+)were extended until the close of (Dec\.|December|March|[A-Za-z]+) (\d{1,2}), (\d{4}); other subdivisions not extended/i.exec(note);
 if(!match)return null;const end=legalTextDate(`${match[2]==='Dec.'?'December':match[2]} ${match[3]}, ${match[4]}`);if(!end)return null;
 const numbers=[...match[1].matchAll(/\((\d+)\)/g)].map(m=>m[1]);if(!numbers.length||new Set(numbers).size!==numbers.length)return null;
 return {numbers,before:nextDay(end),boundary:end};
}
type Ledger={parsedDefinitions:number;supportedDefinitions:number;skippedDefinitions:number;unsupportedScopes:{heading:string;scope:string;hts:string[];reason:string}[];issues:string[]};

/** One source-anchored parser for every retained Section 301 exclusion note.
 * The CBP chart establishes initial windows for older headings. A later printed
 * window is accepted only for headings which explicitly print their legal dates.
 * Partial same-heading extensions are not silently generalized. */
export function compileExclusionHistory(notes:string,noteId:string,windows:ExclusionWindow[],ledger:Ledger):HistoricalExclusion[]{
 const text=notes.replace(/[“”]/g,'"').replace(/\s+/g,' '),result:HistoricalExclusion[]=[];
 const markers=[...text.matchAll(/\(([a-z]{1,3})\)\s*(?:\(i\)\s*)?The U.S. Trade Representative determined to establish a process by which particular products classified/g)];
 
 const configurations=[...windows.map(w=>({heading:w.heading,part:w.part})),{heading:'9903.88.67',part:'ttt'},{heading:'9903.88.68',part:'uuu'},{heading:'9903.88.69',part:'vvv'},{heading:'9903.88.70',part:'www'}].filter((c,i,all)=>all.findIndex(x=>x.heading===c.heading)===i);
 const parts=new Set(configurations.map(c=>c.part));const index=markers.filter((m,i)=>parts.has(m[1])&&markers.findIndex(x=>x[1]===m[1])===i).map(m=>({part:m[1],at:m.index!}));
 for(const config of configurations){
  const begin=index.find(x=>x.part===config.part);if(!begin)continue;
  const nextPart=config.part[0]==='z'?'a'.repeat(config.part.length+1):String.fromCharCode(config.part.charCodeAt(0)+1).repeat(config.part.length),following=new RegExp(`\\(${nextPart}\\)\\s*(?:\\(i\\)\\s*)?[A-Z]`).exec(text.slice(begin.at+10)),end21=text.indexOf('(21)(a)',begin.at),last21=text.indexOf('21. (a)',begin.at);
  const end=[following?begin.at+10+following.index:-1,end21,last21,begin.at+180000].filter(n=>n>begin.at).sort((a,b)=>a-b)[0];
  if(end===begin.at+180000){ledger.issues.push(`${config.heading}: complete product-definition boundary was not established.`);continue;}
  const section=text.slice(begin.at,end),printed=headingWindow(text,config.heading),initial=windows.find(w=>w.heading===config.heading);
  const window=printed?{...printed,sourceIds:[noteId,...(initial?.sourceIds??[])]}:initial?{from:initial.from,before:initial.before,boundaries:[initial.from,initial.before],sourceIds:[noteId,...initial.sourceIds]}:null;
  if(!window){ledger.issues.push(`${config.heading}: no dated legal window was established.`);continue;}
  const roman=[...section.matchAll(/\((i|ii|iii|iv)\)\s*The U.S. Trade Representative determined to establish a process/g)].filter(m=>m.index!>config.part.length+2);
  const groups=roman.length?roman.map((m,i)=>({part:m[1],text:section.slice(m.index,roman[i+1]?.index??section.length)})):[{part:'',text:section}];
  for(const group of groups){
   const first=/\(1\)\s*(?=[A-Z0-9])/.exec(group.text),start=first?.index??-1;if(start<0)continue;const intro=group.text.slice(0,start),renewal=printed?null:numberedExclusionExtension(intro),target=/products classified in heading (9903\.88\.\d{2})/.exec(intro)?.[1];
   if(!target||!intro.includes(`duties`)||!intro.includes('shall not apply'))continue;
   // Explicit heading-to-note link prevents an unrelated numbered list binding.
   const headingAt=text.lastIndexOf(config.heading+' The duty provided in the applicable subheading');
   if(headingAt<0||!text.slice(Math.max(0,headingAt-1600),headingAt).includes(`U.S. note 20(${config.part})`))continue;
   const items=[...group.text.slice(start).matchAll(/\((\d{1,3})\)\s*([A-Z0-9][\s\S]*?)(?=\(\d{1,3}\)\s*[A-Z0-9]|$)/g)];
   if(!items.length||items.length>1000){ledger.issues.push(`${config.heading}: product numbering exceeds its supported bounds.`);continue;}
   if(items.some((m,i)=>i>0&&Number(m[1])<Number(items[i-1][1]))){ledger.issues.push(`${config.heading}: product-definition order is inconsistent; this group needs original-source review.`);continue;}
   const counts=new Map<string,number>();for(const item of items)counts.set(item[1],(counts.get(item[1])??0)+1);
   for(const item of items){if(counts.get(item[1])!==1){ledger.skippedDefinitions++;ledger.issues.push(`${config.heading} note 20(${config.part}): duplicate product number ${item[1]} requires original-source review.`);continue;}const scope=`20(${config.part})${group.part?'('+group.part+')':''}(${item[1]})`,description=item[2].trim();ledger.parsedDefinitions++;
    const codes=exclusionCodeIntervals(description);
    if(!codes){ledger.skippedDefinitions++;ledger.unsupportedScopes.push({heading:config.heading,scope,hts:[...new Set((description.match(/\b\d{4}\.\d{2}\.\d{4}\b/g)??[]).map(c=>c.replaceAll('.','')))],reason:'The dated product-definition layout requires interpretation; no blanket code exemption was inferred.'});continue;}
    ledger.supportedDefinitions++;
    const periods=[{from:window.from,before:window.before,boundaries:window.boundaries},...(renewal?.numbers.includes(item[1])&&renewal.before>window.before?[{from:window.before,before:renewal.before,boundaries:[window.before,renewal.boundary]}]:[])];
    for(const code of codes)for(const period of periods){const from=[period.from,code.from].sort().at(-1)!,before=[period.before,code.before].sort()[0];if(from>=before)continue;
     if(result.length>=20000)throw Error('Historical exclusion definitions exceed their bounded limit.');result.push({heading:config.heading,target,hts:code.hts,scope,description,from,before,boundaryDays:period.boundaries,sourceIds:[...new Set(window.sourceIds)]});
    }
   }
  }
 }
 return result;
}
