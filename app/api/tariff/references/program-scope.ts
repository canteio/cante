/** A pure HTS table may establish legal scope. Mentions inside product prose,
 * end-use definitions, incomplete lists and statistical suffixes may not. */
export function publishedProgramTable(notes:string,heading:string,part:string,next:string):string[]|null{
 const text=notes.replace(/\s+/g,' '),escaped=heading.replaceAll('.','\\.');
 const marker=new RegExp(`\\(${part}\\)\\s*(?:As|as) provided (?:for )?in heading ${escaped},`),begin=marker.exec(text);if(!begin)return null;
 const tail=text.slice(begin.index),end=new RegExp(`\\(${next}\\)\\s*(?:As provided|The additional|Except|For the purposes|For purposes)`).exec(tail);if(!end||end.index>100000)return null;
 const section=tail.slice(0,end.index),colon=section.indexOf(':');if(colon<0||!section.slice(0,colon).includes('shall not apply to')||!/(?:following subheadings|following provisions)/.test(section.slice(0,colon)))return null;
 const body=section.slice(colon+1).replace(/Harmonized Tariff Schedule of the United States.{0,220}?U\.S\. Notes(?: \(con\.\))?/g,' ').replace(/\[Compiler['’]s? note:[^\]]*\]/gi,' ');
 const codes=body.trim().split(/\s+/).filter(Boolean);
 if(codes.length<20||codes.length>5000||codes.some(c=>!/^\d{4}(?:\.\d{2}(?:\.\d{2}(?:\d{2})?)?)?$/.test(c)||Number(c.slice(0,2))>=98)||new Set(codes).size!==codes.length)return null;
 return codes.map(c=>c.replaceAll('.',''));
}
import {createHash} from 'node:crypto';
import {guidanceEntryCutoff} from './cbp-guidance';
import type {Chapter99Action} from './chapter99-contract';

/** Original April 2 annex, effective April 5. This fixed original-clause
 * contract excludes its four known printing-footer tokens. It does not remove
 * arbitrary prose or accept codes mentioned elsewhere in the proclamation. */
export function originalReciprocalTable(action:Chapter99Action){
 if(action.documentNumber!=='2025-06063'||action.text.length>2500000||guidanceEntryCutoff(action,'2025-04-05')!=='00:01')return null;
 const start=action.text.indexOf('ANNEX III 1. Effective'),before=action.text.indexOf('Heading/ Rates of Duty',start);if(start<0||before<=start||createHash('sha256').update(action.text.slice(start,before).trim()).digest('hex')!=='5915c93efb7a7330bf2453c62ad78a87461b2f944b71c4f39bde4395fc3b0d10')return null;
 const at=action.text.indexOf('(iii) As provided in heading 9903.01.32');if(at<0)return null;const tail=action.text.slice(at),end=tail.indexOf('(iv) As provided');if(end<0||end>20000)return null;const clause=tail.slice(0,end).trim();
 if(createHash('sha256').update(clause).digest('hex')!=='91abe211163114f8db24272eaf7152d705c232a42c49ae017a7656975c797724')return null;
 const tokens=clause.slice(clause.indexOf(':')+1).match(/\b\d{4}(?:\.\d{2}(?:\.\d{2})?)?\b/g)??[],footers=new Set(['2014','2025','4705','4790']);
 const codes=tokens.filter(c=>!footers.has(c));if(tokens.length!==1059||codes.length!==1039||new Set(codes).size!==1039||codes.some(c=>Number(c.slice(0,2))>=98))return null;
 return{sourceId:action.id,codes:codes.map(c=>c.replaceAll('.',''))};
}
