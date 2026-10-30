import { bundleSchema, type BundleDefinition } from "./model";
import type { AuditReference } from "@/app/api/tariff/references/store";
import { isStrictIsoDate } from "@/lib/tariff/date";
import { lookupSection301Measure } from "@/lib/tariff/section301";

/** A source-informed DRAFT, never an approval or automatic completeness claim.
 * Dates and base column must be explicitly supplied by the legal reviewer;
 * publisher availability dates are never silently copied into legal intervals. */
export function prepareReferenceDraft(reference:AuditReference,input:{hts:string;origin:string;from:string;before:string;column:"general"|"column2"}){
 if(!/^\d{10}$/.test(input.hts)||!/^[A-Z]{2}$/.test(input.origin)||!isStrictIsoDate(input.from)||!isStrictIsoDate(input.before)||input.before<=input.from||!["general","column2"].includes(input.column))throw Error("Supply an exact code, origin, explicit legal review interval and base-duty column.");
 if(!reference.rate||!reference.release)throw Error("No exact published historical rate is retained for this entry date.");
 const legalSources=reference.sources.filter(s=>["hts_json","chapter99_pdf","legal_document"].includes(s.kind));
 const schedule=legalSources.find(s=>s.id===reference.rate!.source_id),notes=legalSources.find(s=>s.kind==="chapter99_pdf");
 if(!schedule||!notes)throw Error("Retain the original historical schedule and Chapter 99 notes before preparing coverage.");
 const sources=legalSources.map((s,i)=>({id:`REF-${i+1}`,referenceId:s.id}));
 const sourceId=(id:string)=>sources.find(s=>s.referenceId===id)!.id;
 const baseRate=reference.rate[input.column];if(!baseRate)throw Error("The selected historical duty column is not stated.");
 const interval={from:input.from,before:input.before};
 const measures:BundleDefinition["measures"]=[{id:"historical-base",label:`Published ${input.column==="column2"?"Column 2":"general"} base duty`,type:"base",hts:[input.hts],origins:[input.origin],...interval,rate:baseRate,basis:"customs_value",conditions:{},sourceIds:[sourceId(schedule.id)]}];
 const stacking:BundleDefinition["stacking"]=[];
 const warnings=["DRAFT ONLY: review legal effective dates, country regime, transition rules, complete remedy coverage and product-specific exclusions before approval. The requested review interval is not established by publication availability."];
 for(const heading of reference.chapter99){
  const digits=heading.replace(/\D/g,"");const published=reference.chapter99Rates.find(r=>r.hts===digits);const known=lookupSection301Measure(heading);
  if(known?.country==="CN"){
   if(input.origin!=="CN")continue;
   measures.push({id:heading,label:known.list,type:"section301",hts:[input.hts],origins:["CN"],...interval,rate:published?.general||"UNRESOLVED historical rate",basis:"customs_value",conditions:{},sourceIds:[sourceId(schedule.id),sourceId(notes.id)]});
   stacking.push({id:`include-${heading}`,target:heading,action:"include",cap:null,conditions:{exclusion_qualified:false},...interval,explanation:"Requires reviewed historical scope and evidence that these goods do not qualify for an exclusion; qualifying/unknown cases need explicit exclusion rules.",sourceIds:[sourceId(schedule.id),sourceId(notes.id)]});
  }else{
   // An unmodeled heading cannot disappear just because its printed rate is
   // inconvenient. This condition is intentionally not a confirmable entry fact:
   // the reviewer must model its legal scope in the draft before it can resolve.
   measures.push({id:heading,label:`Review historical heading ${heading}`,type:"chapter99",hts:[input.hts],origins:[input.origin],...interval,rate:published?.general||"UNRESOLVED historical heading",basis:"customs_value",conditions:{__historical_scope_review__:true},sourceIds:[sourceId(schedule.id),sourceId(notes.id)]});
   warnings.push(`Model ${heading}'s scope/exclusion and interaction explicitly; its guard keeps calculations unresolved until that definition is reviewed.`);
  }
 }
 const definition=bundleSchema.parse({version:1,synthetic:false,title:`DRAFT ${reference.release.name}: ${input.hts} / ${input.origin}`,supersedes:[],coverage:[{hts:[input.hts],origins:[input.origin],...interval,requiredFacts:["standard_commercial","origin_verified","classification_verified","adcvd_clear","other_232_clear"],sourceIds:sources.map(s=>s.id)}],measures,stacking});
 return {definition,sources,warnings};
}
