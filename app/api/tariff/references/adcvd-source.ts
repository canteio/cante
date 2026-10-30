import {isStrictIsoDate} from '@/lib/tariff/date';

export const ADCVD_PUBLIC_ROOT='https://trade.cbp.dhs.gov/ace/adcvd/adcvd-public/';
export const ADCVD_PUBLIC_API='https://trade.cbp.dhs.gov/ace/adcvd/service-messages/messages/public/';
export function adcvdCase(raw:string){const value=raw.replaceAll('-','').toUpperCase();if(!/^[AC]\d{6}(?:\d{3})?$/.test(value))throw Error('Use an exact AD/CVD case number.');return value;}
export function adcvdPublicUrl(raw:string){const u=new URL(raw);return u.origin==='https://trade.cbp.dhs.gov'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&(new RegExp('^/ace/adcvd/service-messages/messages/public/quickSearchMessage-MemorySide/[AC]\\d{6}(?:\\d{3})?$').test(u.pathname)||/^\/ace\/adcvd\/service-messages\/messages\/public\/(?:getMessageHeaderDetails|getMsgBody)\/\d{1,10}$/.test(u.pathname));}
export function cbpMessageDate(raw:unknown):string|null{if(typeof raw!=='string')return null;const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);const value=m?`${m[3]}-${m[1]}-${m[2]}`:'';return isStrictIsoDate(value)?value:null;}
export type AdcvdIndexRow={imn:string;messageNumber:string;messageDate:string;caseNumber:string;type:string;status:string;publicIndicator:string;messageTitle:string};
export function adcvdIndex(raw:unknown,caseNumber:string){
 const root=adcvdCase(caseNumber).slice(0,7),value=raw as {currentLimit?:unknown;returningLimitedResults?:unknown;totalRecords?:unknown;resultData?:unknown;displayMsg?:unknown};
 if(!value||value.returningLimitedResults!==false||!Number.isInteger(value.totalRecords)||Number(value.totalRecords)<0||Number(value.totalRecords)>500||!Array.isArray(value.resultData)||value.resultData.length!==value.totalRecords||typeof value.currentLimit!=='number'||value.currentLimit<value.resultData.length)throw Error('The public case search is incomplete or exceeds its bounded 500-message scope. Use a supported paginated capture before calculation.');
 const ids=new Set<string>(),rows:AdcvdIndexRow[]=[];
 for(const item of value.resultData){if(!item||typeof item.imn!=='string'||!/^\d{1,10}$/.test(item.imn)||ids.has(item.imn)||typeof item.messageNumber!=='string'||!/^\d{7,8}$/.test(item.messageNumber)||!cbpMessageDate(item.messageDate)||typeof item.caseNumber!=='string'||!item.caseNumber.split(/;\s*/).includes(root)||item.publicIndicator!=='Y'||!['Active','Inactive'].includes(item.status)||typeof item.type!=='string'||typeof item.messageTitle!=='string'||item.messageTitle.length>2000)throw Error('Public AD/CVD case index identity or disclosure status is invalid.');ids.add(item.imn);rows.push(item);}
 return{caseNumber:root,rows,complete:true as const};
}
export type AdcvdHeader={imn:string;messageNumber:string;caseNumberList:string[];messageDate:string;effectiveDate:string;type:string;statusDesc:string;statusCode:string;accessType:string;correctionMessage:boolean;originalImn:string;inactiveDate:string;frCite:string;frDate:string;messageTitle:string};
export function adcvdHeader(raw:unknown,index:AdcvdIndexRow,caseNumber:string):AdcvdHeader{
 const h=raw as AdcvdHeader,root=adcvdCase(caseNumber).slice(0,7);
 if(!h||h.accessType!=='Public'||h.imn!==index.imn||h.messageNumber!==index.messageNumber||!Array.isArray(h.caseNumberList)||!h.caseNumberList.includes(root)||h.messageDate!==index.messageDate||h.type!==index.type||h.statusDesc!==index.status||!cbpMessageDate(h.messageDate)||typeof h.effectiveDate!=='string'||h.effectiveDate!==''&&!cbpMessageDate(h.effectiveDate)||typeof h.correctionMessage!=='boolean'||typeof h.originalImn!=='string'||typeof h.inactiveDate!=='string'||h.inactiveDate!==''&&!cbpMessageDate(h.inactiveDate)||typeof h.frCite!=='string'||typeof h.frDate!=='string'||h.frDate!==''&&!cbpMessageDate(h.frDate)||typeof h.messageTitle!=='string')throw Error('The public instruction header does not match its retained case index.');return h;
}
export function adcvdBody(raw:unknown){const text=(raw as {text?:unknown})?.text;if(typeof text!=='string'||!text.trim()||text.length>500000)throw Error('The public instruction body is empty or exceeds its bound.');return text;}
async function boundedBytes(response:Response,max=3000000){if(!response.ok||!response.body)throw Error(`Public AD/CVD source HTTP ${response.status}.`);const reader=response.body.getReader(),parts:Uint8Array[]=[];let bytes=0;try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>max)throw Error('Public AD/CVD original exceeds its byte bound.');parts.push(part.value);}}finally{await reader.cancel().catch(()=>{});}return Buffer.concat(parts,bytes);}
/** A new anonymous public session, never a browser cookie, customer credential,
 * ACE account or access to non-public messages. Every endpoint is a read-only
 * GET exposed by CBP's public client. Session cookies stay request-local. */
export async function publicAdcvdSession(signal?:AbortSignal){
 const bounded=()=>signal?AbortSignal.any([signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000);
 const bootstrap=await fetch(ADCVD_PUBLIC_ROOT,{redirect:'error',signal:bounded(),cache:'no-store'});if(!bootstrap.ok)throw Error(`Public AD/CVD session HTTP ${bootstrap.status}.`);
 const cookie=bootstrap.headers.getSetCookie().map(c=>c.split(';',1)[0]).join('; ');await bootstrap.body?.cancel();
 return async(url:string)=>{if(!adcvdPublicUrl(url))throw Error('Only exact public AD/CVD read URLs are allowed.');return boundedBytes(await fetch(url,{redirect:'error',cache:'no-store',signal:bounded(),headers:{...(cookie?{cookie}:{}),globalTrackingId:'cante-public-reference'}}));};
}
