import {z} from 'zod';
import{parseDutyRate}from'@/lib/tariff/duty-expression';

// Subtract only the metal portions actually covered by a duty. A copper value
// is not a steel exclusion; missing unrelated metal values are not guessed zero.
export const metalRemainderBases={
 non_steel_content:['steelValue'],non_aluminum_content:['aluminumValue'],non_copper_content:['copperValue'],
 non_steel_aluminum_content:['steelValue','aluminumValue'],non_steel_copper_content:['steelValue','copperValue'],non_aluminum_copper_content:['aluminumValue','copperValue'],
 non_metal_content:['steelValue','aluminumValue','copperValue'],
} as const;

// These are declared shipment inputs. They are never qualification evidence or
// rates. Evidence-backed review can confirm/correct them without editing raw CSV.
export const shipmentFields={
 entryTimestamp:'Entry timestamp (with timezone)',entryType:'Customs entry type',
 relatedArticleHts:'Related complete article HTS (exact 10 digits)',
 componentGroup:'Watch / clock component group',articleValue:'Complete article value (USD)',
 primaryQuantity:'Corrected primary quantity',primaryUnit:'Corrected primary quantity unit',
 dutiableJewels:'Dutiable jewel count (after the exemption)',
 manufacturer:'Manufacturer identifier',exporter:'Exporter identifier',
 steelValue:'Steel content value (USD)',aluminumValue:'Aluminum content value (USD)',
 copperValue:'Copper content value (USD)',copperQuantityKg:'Copper content quantity (kg)',usValue:'U.S. content value (USD)',
 metalWeightPercent:'Applicable metal weight (%)',
 dutiableValue:'Repair / processing dutiable value (USD)',
 dutyStage:'Duty stage (cash_deposit / final_assessment)',preference:'Preference / special program indicator',cases:'AD/CVD case numbers',
 quantity2:'Second quantity',unit2:'Second quantity unit',quantity3:'Third quantity',unit3:'Third quantity unit',
} as const;
export const shipmentAliases:Record<keyof typeof shipmentFields,string[]>={
 entryTimestamp:['entry_timestamp','entry_datetime','entry_time'],entryType:['entry_type','entry_type_code'],
 dutiableJewels:['dutiable_jewels','dutiable_jewel_count','dutiable_jewel_quantity'],
 primaryQuantity:['corrected_primary_quantity','confirmed_quantity'],primaryUnit:['corrected_primary_unit','confirmed_unit'],
 relatedArticleHts:['related_article_hts','complete_article_hts','parent_article_hts'],
 componentGroup:['component_group','watch_component_group','article_group'],articleValue:['article_total_value','article_total_value_usd','complete_article_value','complete_article_value_usd'],
 manufacturer:['manufacturer','manufacturer_id','mid'],exporter:['exporter','exporter_id'],
 steelValue:['steel_content_value','steel_content_value_usd','steel_value'],aluminumValue:['aluminum_content_value','aluminium_content_value','aluminum_value'],
 copperValue:['copper_content_value','copper_value'],copperQuantityKg:['copper_content_quantity_kg','copper_quantity_kg','copper_weight_kg'],usValue:['us_content_value','us_content_value_usd'],
 metalWeightPercent:['metal_weight_percent','applicable_metal_weight_percent'],
 dutiableValue:['dutiable_value','repair_value','processing_value'],
 dutyStage:['duty_stage','payment_stage'],preference:['preference','preference_code','spi','special_program_indicator'],cases:['adcvd_cases','ad_cvd_cases','case_numbers'],
 quantity2:['quantity_2','second_quantity'],unit2:['unit_2','second_unit'],quantity3:['quantity_3','third_quantity'],unit3:['unit_3','third_unit'],
};
const decimal=z.string().regex(/^\d{1,16}(?:\.\d{1,8})?$/),money=z.string().regex(/^\d{1,13}(?:\.\d{1,2})?$/).transform(s=>{const [whole,part='']=s.split('.');return BigInt(whole).toString()+'.'+part.padEnd(2,'0');});
export const shipmentSchema=z.object({
 entryTimestamp:z.string().datetime({offset:true}).refine(v=>Number.isFinite(Date.parse(v)),'Use a real timestamp and timezone offset.').optional(),entryType:z.string().regex(/^\d{2}$/).optional(),
 relatedArticleHts:z.string().regex(/^\d{10}$/).optional(),
 componentGroup:z.string().trim().min(1).max(100).optional(),articleValue:money.optional(),
 dutiableJewels:z.string().regex(/^\d{1,16}$/).optional(),
 primaryQuantity:decimal.optional(),primaryUnit:z.string().trim().min(1).max(30).optional(),
 manufacturer:z.string().trim().min(1).max(200).optional(),exporter:z.string().trim().min(1).max(200).optional(),
 steelValue:money.optional(),aluminumValue:money.optional(),copperValue:money.optional(),copperQuantityKg:decimal.optional(),usValue:money.optional(),
 dutiableValue:money.optional(),metalWeightPercent:decimal.refine(v=>Number(v)<=100).optional(),
 dutyStage:z.enum(['cash_deposit','final_assessment']).optional(),preference:z.string().trim().min(1).max(20).optional(),cases:z.array(z.string().regex(/^[AC]-\d{3}-\d{3}(?:-\d{3})?$/)).max(20).refine(c=>new Set(c).size===c.length,'Duplicate AD/CVD case numbers are not allowed.').refine(c=>new Set(c.map(n=>n.slice(0,9))).size===c.length,'Use one company case per AD/CVD order on each entry line; split lines with separately allocated values.').optional(),
 quantity2:decimal.optional(),unit2:z.string().trim().min(1).max(30).optional(),quantity3:decimal.optional(),unit3:z.string().trim().min(1).max(30).optional(),
}).strict();
export type ShipmentDetails=z.infer<typeof shipmentSchema>;
export function easternEntryDate(timestamp:string){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(timestamp));}
/** Compare the actual instant in the legal Eastern timezone, not the CSV's
 * written offset or a fixed EST/EDT offset. A different date is never coerced. */
export function atEasternCutoff(timestamp:string|undefined,date:string,time:'00:00'|'00:01'):boolean|null{
 if(!timestamp||!shipmentSchema.shape.entryTimestamp.safeParse(timestamp).success||easternEntryDate(timestamp)!==date)return null;
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hourCycle:'h23',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(timestamp)),part=(key:string)=>parts.find(p=>p.type===key)!.value;
 return `${part('hour')}:${part('minute')}:${part('second')}`>=time+':00';
}
export function normalizedQuantity(raw:string){const [whole,part='']=raw.split('.');return BigInt(whole).toString()+'.'+part.replace(/0+$/,'');}
export function primaryShipmentQuantity(entry:{quantity?:string|null;unit?:string;shipment?:ShipmentDetails}){return{quantity:entry.shipment?.primaryQuantity??entry.quantity??null,unit:entry.shipment?.primaryUnit??entry.unit??''};}
/** Equivalent litre spellings only; no volume conversion. LT (long tons),
 * proof litres and millilitres never become litres. Original units stay saved. */
const quantityUnit=(unit:string)=>/^(?:l|liters?|litres?)$/i.test(unit.trim())?'l':unit.trim().toLowerCase();
export function shipmentQuantity(entry:{quantity?:string|null;unit?:string;shipment?:ShipmentDetails},rate:string){
 const required=parseDutyRate(rate).specificUnit,quantities=[primaryShipmentQuantity(entry),{quantity:entry.shipment?.quantity2??null,unit:entry.shipment?.unit2??''},{quantity:entry.shipment?.quantity3??null,unit:entry.shipment?.unit3??''},...(entry.shipment?.dutiableJewels!==undefined?[{quantity:entry.shipment.dutiableJewels,unit:'djwl'}]:[])].filter(q=>q.quantity!==null&&!!required&&quantityUnit(q.unit)===quantityUnit(required)),selected=quantities[0]??primaryShipmentQuantity(entry);
 return{...selected,unit:required&&quantityUnit(selected.unit)===quantityUnit(required)?required:selected.unit,conflict:!!required&&new Set(quantities.map(q=>normalizedQuantity(q.quantity!))).size>1};
}

/** Keep each original-PDF lookup within its existing per-chapter page budget.
 * Preserve input order and checkpoint identity; the user still uploads one CSV. */
export function referenceGroupEnd(entries:{date:string;hts:string}[],start:number){
 if(!Number.isInteger(start)||start<0||start>=entries.length)throw Error('Invalid audit reference checkpoint.');
 let end=start+1;while(end<entries.length&&end-start<25&&entries[end].date.slice(0,7)===entries[start].date.slice(0,7)&&entries[end].hts.slice(0,2)===entries[start].hts.slice(0,2))end++;
 return end;
}

/** The user supplies the classified complete article, never a guessed parent.
 * These legal lines expressly reference its rate. Specific quantities and mixed
 * juice procedures require their own applicability contract. */
export function relatedArticleHeading(hts:string):string|null {
 if(/^90159001\d{2}$/.test(hts))return '9015';
 if(hts==='9620001500')return '9005';
 if(/^96200030\d{2}$/.test(hts))return '9015';
 return null;
}

/** Shared exact scope predicate for server calculation and relevant UI evidence.
 * An eight-digit family never overrides its explicit ten-digit exceptions. */
export function historicalMeasureCovers(measure:{hts8:string[];excludedHts10?:string[]},hts:string){return /^\d{10}$/.test(hts)&&measure.hts8.includes(hts.slice(0,8))&&!measure.excludedHts10?.includes(hts);}
