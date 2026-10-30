import type {ReferenceRate} from './store';
import {computeExactDuty} from '@/lib/tariff/duty-expression';
const scale=100000000n;
function percent(rate:string){if(/^Free$/i.test(rate))return 0n;const m=/^(\d+)(?:\.(\d{1,8}))?%$/.exec(rate);return m?BigInt(m[1])*scale+BigInt((m[2]??'').padEnd(8,'0')):null;}
export type EquivalentInput={value:string|null;quantity?:string|null;unit?:string|null};
/** A content allocation retains the ordinary duty on the whole article. For a
 * published combined percentage, only its exact additional portion may apply
 * to the non-metal value. Specific/compound rates need their own allocation. */
export function combinedAdditionalPercent(combinedRate:string,baseRate:string):string|null{
 const combined=percent(combinedRate),base=percent(baseRate);if(combined===null||base===null||combined<base)return null;
 const diff=combined-base;if(diff===0n)return 'Free';const fraction=String(diff%scale).padStart(8,'0').replace(/0+$/,'');return `${diff/scale}${fraction?'.'+fraction:''}%`;
}
export function baseBelowThreshold(baseRate:string,thresholdRate:string,input?:EquivalentInput):boolean|null{
 const base=percent(baseRate),threshold=percent(thresholdRate);if(threshold===null)return null;if(base!==null)return base<threshold;
 if(!input?.value||!/^\d+\.\d{2}$/.test(input.value))return null;const value=BigInt(input.value.replace('.',''));if(value===0n)return null;const duty=computeExactDuty(baseRate,input);if(duty===null)return null;return BigInt(duty.replace('.',''))*100n*scale<threshold*value;
}
/** Choose the published below/above-threshold pair using exact decimal
 * arithmetic. A below-threshold row replaces the ordinary base; it is not a
 * second full percentage added on top of that base. Quantity/compound base
 * rates use the payable base amount divided by the explicit customs value, with
 * exact cross multiplication rather than a rounded percentage. */
export function combinedHeading(rows:ReferenceRate[],baseRate:string,input?:EquivalentInput){
 const parsed=rows.map(row=>{const below=/less than (\d+(?:\.\d+)?) percent/.exec(row.description),above=/equal to or greater than (\d+(?:\.\d+)?) percent/.exec(row.description);return {row,below:!!below,threshold:below?.[1]??above?.[1]??null};});
 if(parsed.length!==2||parsed.some(p=>!p.threshold)||new Set(parsed.map(p=>p.threshold)).size!==1||parsed.filter(p=>p.below).length!==1)return null;
 const below=baseBelowThreshold(baseRate,parsed[0].threshold!+'%',input);if(below===null)return null;
 const selected=parsed.find(p=>p.below===below)!;
 if(selected.below&&selected.row.general.trim()===selected.threshold+'%')return {row:selected.row,rate:selected.threshold+'%',replacesBase:true};
 if(!selected.below&&selected.row.general.trim()==='The duty provided in the applicable subheading')return {row:selected.row,rate:'Free',replacesBase:false};
 return null;
}
