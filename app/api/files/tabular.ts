import { parseCsv } from "@/lib/catalogue/csv";
import type { ExtractedFile, ExtractedTable } from "@/lib/documents/extract-file";
export type ValueBasis="annual"|"units"|"historical";
export type ColumnMapping=Record<string,number>;
export type TablePreview={index:number;headerRow:number;label:string;headers:string[];sampleRows:string[][];totalRows:number;mapping:ColumnMapping;basis:ValueBasis;requiresReview:boolean;issues:string[];ready:boolean};
export const FIELD_LABELS:Record<string,string>={sku:"SKU / part number",hts_code:"10-digit HTS",origin_country:"Country of origin",annual_customs_value_usd:"Annual customs value · USD",unit_customs_value_usd:"Customs value per unit · USD",annual_import_units:"Annual units imported",entry_id:"Customs entry ID",line_number:"Entry line number",entry_date:"Entry date · YYYY-MM-DD",customs_value_usd:"Entry customs value · USD"};
const aliases:Record<string,string[]>={name:["name","product_name"],sku:["sku","part_number","part_no","part_#","item_code","product_code"],hts_code:["hts_code","hts","htsus","htsus_code"],origin_country:["origin_country","country_of_origin","origin","made_in"],annual_customs_value_usd:["annual_customs_value_usd","annual_customs_value_(usd)"],unit_customs_value_usd:["unit_customs_value_usd"],annual_import_units:["annual_import_units"],entry_id:["entry_id","customs_entry_id"],line_number:["line_number","entry_line_number"],entry_date:["entry_date"],customs_value_usd:["customs_value_usd","customs_value_(usd)"],annual_quantity:["annual_quantity"],quantity_unit:["quantity_unit"],paid_duty_usd:["paid_duty_usd"],dataset_label:["dataset_label"]};
for(const fact of ["standard_commercial","metal_weight_percent","us_metal_qualification","uk_metal_qualification","special_232_claim","equipment_use","motorcycle_use","other_232_heading"])aliases[fact]=[fact];
const normalized=(text:string)=>text.trim().toLowerCase().replace(/[–—-]/g,"_").replace(/\s+/g,"_");
const cell=(v:string)=>'"'+v.replaceAll('"','""')+'"';
export function requiredFields(basis:ValueBasis){return ["sku","hts_code","origin_country",...(basis==="annual"?["annual_customs_value_usd"]:basis==="units"?["unit_customs_value_usd","annual_import_units"]:["entry_id","line_number","entry_date","customs_value_usd"])];}
function inferred(headers:string[]){const mapping:ColumnMapping={};const issues:string[]=[];for(const [field,names] of Object.entries(aliases)){const matches=headers.map((h,i)=>names.includes(normalized(h))?i:-1).filter(i=>i>=0);if(matches.length===1)mapping[field]=matches[0];if(matches.length>1)issues.push(`Choose which ${FIELD_LABELS[field]??field} column to use.`);}return {mapping,issues};}
function textTables(text:string,pdf:boolean):ExtractedTable[]{
 const lines=text.split(/\r?\n/).filter(line=>line.trim());
 // No prose-to-number inference. Only explicit delimiter-separated tables qualify.
 const delimiter=lines.some(line=>line.includes("\t"))?"\t":",";
 const converted=delimiter==="\t"?lines.map(line=>line.split("\t").map(cell).join(",")).join("\n"):text;
 try{const table=parseCsv(converted,{columns:100,rawRows:20002,cellCharacters:20000},true,true);
 if(new Set(table.headers).size!==table.headers.length)throw Error("Duplicate column headers");
 return table.headers.length>1?[{label:pdf?"PDF text table":"CSV table",rows:[table.headers,...table.rows.map(row=>table.headers.map(h=>row[h]??""))],requiresReview:pdf,issues:pdf?["PDF layout needs confirmation. Compare the detected rows with the original."]:[]}]:[];}catch{return [];}
}
export function fileTables(extracted:ExtractedFile,originalCsv?:string):ExtractedTable[]{return extracted.tables??textTables(originalCsv??extracted.text,extracted.format==="pdf");}
export function tablePreviews(tables:ExtractedTable[]):TablePreview[]{
 if(tables.length>30)throw Error("More than 30 tables or worksheets were found. Split the file before checking.");
 let previewCharacters=60000;
 return tables.map((table,index)=>{
  const headerIndex=table.rows.slice(0,20).findIndex(row=>{const {mapping}=inferred(row);return Object.keys(mapping).length>=2&&(mapping.hts_code!==undefined||mapping.sku!==undefined);});
  const offset=headerIndex<0?0:headerIndex;const headers=table.rows[offset]??[];const rows=table.rows.slice(offset+1);const {mapping,issues}=inferred(headers);
  if(mapping.annual_customs_value_usd!==undefined&&(mapping.customs_value_usd!==undefined||mapping.unit_customs_value_usd!==undefined))issues.push("Choose the value basis: this table contains more than one customs-value column.");
  const basis:ValueBasis=mapping.entry_id!==undefined||mapping.customs_value_usd!==undefined?"historical":mapping.unit_customs_value_usd!==undefined&&mapping.annual_import_units!==undefined?"units":"annual";
  const missing=requiredFields(basis).filter(field=>mapping[field]===undefined);
  const widthIssue=rows.some(row=>row.length>headers.length);const allIssues=[...table.issues,...issues,...missing.map(f=>`Select ${FIELD_LABELS[f]}.`),...(widthIssue?["Some rows contain more columns than the header. Check the original layout."]:[])];
  const sampleRows:string[][]=[];
  for(const row of rows.slice(0,5)){const preview=row.map(c=>c.slice(0,120));const size=preview.reduce((n,c)=>n+c.length,0);if(size>previewCharacters){allIssues.push("Some preview rows were omitted; download the original for column review.");break;}previewCharacters-=size;sampleRows.push(preview);}
  return {index,headerRow:offset,label:table.label.slice(0,120),headers:headers.map(h=>h.slice(0,160)),sampleRows,totalRows:rows.length,mapping,basis,requiresReview:table.requiresReview||tables.length>1||allIssues.length>0,issues:allIssues,ready:!table.requiresReview&&tables.length===1&&!allIssues.length&&rows.length>0};
 });
}
export function canonicalTableCsv(tables:ExtractedTable[],index:number,selected?:unknown,basis?:unknown,confirmed=false){
 const previews=tablePreviews(tables);const preview=previews[index];if(!preview)throw Error("Choose a detected table or worksheet.");
 if(!selected&&!preview.ready)throw Error("Review and confirm the detected columns before running a tariff check.");
 if(selected&&!confirmed)throw Error("Confirm your column choices before checking.");
 const mapping=(selected??preview.mapping) as ColumnMapping;const mode=(basis??preview.basis) as ValueBasis;
 if(!["annual","units","historical"].includes(mode)||typeof mapping!=="object"||mapping===null||Array.isArray(mapping))throw Error("Invalid column mapping.");
 const keys=Object.keys(mapping);const used=new Set<number>();
 for(const key of keys){const value=mapping[key];if(!Object.hasOwn(aliases,key)||!Number.isInteger(value)||value<0||value>=preview.headers.length||used.has(value))throw Error("Choose a different existing column for each field.");used.add(value);}
 for(const required of requiredFields(mode))if(mapping[required]===undefined)throw Error(`Select ${FIELD_LABELS[required]}.`);
 const table=tables[index];
 const rows=table.rows.slice(preview.headerRow+1);
 if(!rows.length||rows.length>6000)throw Error("Use at most 6,000 import rows or 100 product rows per check. Split larger tables; no rows were skipped.");
 // Do not accidentally convert historical values into annual exposure, or vice versa.
 const allowed=keys.filter(k=>mode==="historical"?!["annual_customs_value_usd","unit_customs_value_usd","annual_import_units","annual_quantity"].includes(k):!["entry_id","line_number","entry_date","customs_value_usd","paid_duty_usd",...(mode==="annual"?["unit_customs_value_usd","annual_import_units"]:["annual_customs_value_usd"])].includes(k));
 const normalizedRows=rows.map((row,i)=>allowed.map(key=>{
  let value=row[mapping[key]]?.trim()??"";
  if(/customs_value.*usd|paid_duty_usd/.test(key)){
   if(/[A-Za-z]/.test(value.replace(/\bUSD\b/gi,"")))throw Error(`Row ${i+2}: values must be USD customs values; currencies are never converted automatically.`);
   value=value.replace(/\bUSD\b/gi,"").replace(/[$,\s]/g,"");
  }
  return cell(value);
 }).join(","));
 return {csv:[allowed.join(","),...normalizedRows].join("\n"),preview,mapping,basis:mode};
}
