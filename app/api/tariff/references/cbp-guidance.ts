import {load} from 'cheerio';
export const HISTORICAL_CBP_GUIDANCE=[
 {number:'68762890',bulletin:'4193d0a'},
 {number:'65054270',bulletin:'3e0a63e'},
 {number:'65236574',bulletin:'3e36e5e'},
 {number:'64384423',bulletin:'3d66da7'},
 {number:'64384496',bulletin:'3d66df0'},
 {number:'65236374',bulletin:'3e36d96'},
 {number:'65236645',bulletin:'3e36ea5'},
 {number:'65289012',bulletin:'3e43b34'},
 {number:'65441222',bulletin:'3e68dc6'},
 {number:'65936570',bulletin:'3ee1cba'},
 {number:'65936615',bulletin:'3ee1ce7'},
 {number:'68253075',bulletin:'4117593'},
 {number:'68554727',bulletin:'4160fe7'},
 {number:'68855869',bulletin:'41aa83d'},
 {number:'64624801',bulletin:'3da18a1'},
 {number:'66492057',bulletin:'3f69699'},
 {number:'66665333',bulletin:'3f93b75'},
 {number:'66684128',bulletin:'3f984e0'},
 {number:'65794272',bulletin:'3ebf0e0'},
 {number:'64297449',bulletin:'3d519e9'},
 {number:'64336037',bulletin:'3d5b0a5'},
 {number:'64472173',bulletin:'3d7c46d'},
 {number:'66242844',bulletin:'3f2c91c'},
 {number:'66987366',bulletin:'3fe2566'},
 {number:'67045953',bulletin:'3ff0a41'},
 {number:'66027027',bulletin:'3ef7e13'},
 {number:'67702087',bulletin:'4090d47'},
 {number:'67133044',bulletin:'4005e74'},
 {number:'65807735',bulletin:'3ec2577'},
 {number:'66871909',bulletin:'3fc6265'},
 {number:'64297292',bulletin:'3d5194c'},
 {number:'64335789',bulletin:'3d5afad'},
 {number:'65798609',bulletin:'3ec01d1'},
 {number:'64299816',bulletin:'3d52328'},
 {number:'64680374',bulletin:'3daf1b6'},
 {number:'64687696',bulletin:'3db0e50'},
 {number:'64701128',bulletin:'3db42c8'},
 {number:'65029337',bulletin:'3e044d9'},
 {number:'65573545',bulletin:'3e892a9'},
 {number:'65829726',bulletin:'3ec7b5e'},
 {number:'65894387',bulletin:'3ed77f3'},
 {number:'67844987',bulletin:'40b3b7b'},
 {number:'66749380',bulletin:'3fa83c4'},
 {number:'67834313',bulletin:'40b11c9'},
] as const;
export type CbpGuidance={id:string;number:string;text:string};
/** Only an explicit operative "on or after" midnight/00:01 Eastern clause.
 * Publication times, an ACE deployment time and transit deadlines are not
 * substituted for an entry cutoff. The caller already validates this source's
 * identity, program, rate and effective date. */
export function guidanceEntryCutoff(source:Pick<CbpGuidance,'text'>,date:string):'00:00'|'00:01'|null{
 const printed=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'long',day:'numeric',year:'numeric'}).format(new Date(date+'T12:00:00Z'));
 const clause=new RegExp('(?:entered for consumption|withdrawn from warehouse for consumption),?\\s+on or after 12:(00|01)\\s*a\\.m\\.\\s*(?:eastern (?:standard |daylight )?time(?: \\(EDT\\))?|ET|EDT|EST)\\s+(?:on )?'+printed.replace(',','[,]?'),'gi');
 const times=[...source.text.replace(/\s+/g,' ').matchAll(clause)].map(m=>'00:'+m[1]);
 return times.length&&new Set(times).size===1?times[0] as '00:00'|'00:01':null;
}
export function cbpGuidanceText(bytes:Buffer,number:string){
 if(bytes.length>1000000||!/^\d{8}$/.test(number))throw Error('CBP guidance exceeds its bounded identity contract.');
 const $=load(new TextDecoder('utf-8',{fatal:true}).decode(bytes));$('script,style,nav,footer').remove();
 const text=$('body').text().replace(/\s+/g,' ').trim();
 if(!text.includes(`CSMS # ${number}`)||!text.includes('U.S. Customs and Border Protection')||!text.includes('Cargo Systems Messaging Service'))throw Error('CBP guidance identity changed.');
 return text;
}

/** Pin the full archive selection at audit creation, but read only the
 * instruments required by this bounded execution group. */
export function neededHistoricalGuidance(entries:{date:string;origin?:string;hts?:string}[]){
 const ids=new Set<string>();for(const {date,origin,hts}of entries){
  if(date>='2025-10-10'&&(!hts||/^(?:44|9401|9403)/.test(hts))){ids.add('66492057');if(origin==='KR'&&date>='2025-11-14')ids.add('66987366');if(origin==='TW'&&date>='2026-05-01')ids.add('68762890');}
  if(date>='2026-06-08')ids.add('68855869');
  if(date>='2026-04-06'&&date<'2026-06-08')for(const number of ['68253075','68554727'])ids.add(number);
  if(date>='2025-08-01'&&date<'2026-04-06')ids.add('65794272');
  if(date>='2025-03-12'&&date<'2026-04-06'){
   for(const number of ['64384423','64384496','65054270'])ids.add(number);
   if(date>='2025-06-04')for(const number of ['65236374','65236645','65236574'])ids.add(number);
   if(date>='2025-06-23')ids.add('65441222');
   if(date>='2025-08-18')for(const number of ['65936570','65936615'])ids.add(number);
  }
  if(date<'2025-02-04')continue;if(!origin){for(const item of HISTORICAL_CBP_GUIDANCE)ids.add(item.number);continue;}
  if(['CA','MX'].includes(origin)&&date>='2025-03-04'&&date<'2026-02-24'){ids.add(origin==='CA'?'64297449':'64297292');if(date>='2025-03-07')ids.add(origin==='CA'?'64336037':'64335789');if(origin==='CA'&&date>='2025-08-01')ids.add('65798609');}
  if(origin==='IN'&&date>='2025-08-27'){ids.add('66027027');ids.add('67702087');}
  if(date>='2026-02-24'){ids.add('67834313');if(date<'2026-07-24')ids.add('67844987');continue;}
  if(origin==='CN'){ids.add('64299816');if(date>='2025-11-10')ids.add('66749380');}
  if(date<'2025-04-05')continue;ids.add('64680374');
  if(date<'2025-04-09')continue;
  if(date<'2025-04-10'){if(origin==='CN')ids.add('64687696');continue;}
  if(origin==='CN')ids.add(date<'2025-05-14'?'64701128':date<'2025-08-12'?'65029337':date<'2025-11-10'?'65894387':'66749380');
  else if(date<'2025-08-07'){ids.add('64701128');if(date>='2025-07-09')ids.add('65573545');}
  else if(date>='2025-08-07')ids.add('65829726');
  if(origin==='JP'&&date>='2025-08-07')ids.add('66242844');
  if(origin==='KR'&&date>='2025-11-14'){ids.add('66987366');ids.add('67045953');}
  if(['CH','LI'].includes(origin)&&date>='2025-11-14')ids.add('67133044');
 }
 return ids;
}

/** Rulings corroborate an allocation method only. Their product classification
 * and fact-specific holdings are never applied to another shipment. */
export const HISTORICAL_CBP_RULINGS=[{number:'N356087',year:2025,division:'ny',issuedOn:'2025-12-09'}] as const;
export type CbpRuling={id:string;number:string;text:string};
export function validateCbpRuling(text:string,number:string){
 const item=HISTORICAL_CBP_RULINGS.find(r=>r.number===number);if(!item||text.length>100000||!text.includes('U.S. Customs and Border Protection')||!text.includes(number)||!text.includes('December 9, 2025')||!text.includes('applies only to the specific factual situation'))throw Error('The retained CBP ruling identity or limitation was not established.');
 return text;
}
