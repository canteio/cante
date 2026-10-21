"use client";
import { useState } from "react";
import { FIELD_LABELS,requiredFields,type ValueBasis } from "@/app/api/files/tabular";
import type { FileAttachment } from "./upload-file";
export function FileColumnReview({file,onChange}:{file:FileAttachment;onChange:(file:FileAttachment)=>void}){
 const [open,setOpen]=useState(!file.tables?.[0]?.ready);
 const table=file.tables?.[file.tableIndex??0];if(!table)return null;
 const basis=(file.basis??table.basis) as ValueBasis;const mapping=file.mapping??table.mapping;
 const confirmed=file.mappingConfirmed||table.ready&&!file.mapping;
 const choose=(change:Partial<FileAttachment>)=>onChange({...file,...change,mappingConfirmed:false,skipCheck:false});
 return <section className="chat-file-review"><button type="button" className="chat-file-review-toggle" onClick={()=>setOpen(!open)}>{file.skipCheck?"Ready for questions":confirmed?"✓ Columns ready":"Review columns"}<span>{table.totalRows.toLocaleString()} rows · {file.filename}</span></button>
 {open&&<div className="chat-file-review-body">
 {file.tables!.length>1&&<label>Table or worksheet<select value={file.tableIndex??0} onChange={e=>{const t=file.tables![Number(e.target.value)];choose({tableIndex:t.index,mapping:t.mapping,basis:t.basis});}}>{file.tables!.map(t=><option key={t.index} value={t.index}>{t.label} · {t.totalRows} rows</option>)}</select></label>}
 <label>What do these values describe?<select value={basis} onChange={e=>{const next=e.target.value as ValueBasis;const core=new Set(Object.keys(FIELD_LABELS));choose({basis:next,mapping:Object.fromEntries(Object.entries(mapping).filter(([key])=>!core.has(key)||requiredFields(next).includes(key)))});}}><option value="annual">Annual imports · total customs value in USD</option><option value="units">Annual imports · unit customs value × annual units</option><option value="historical">Past customs entries · entry values in USD</option></select></label>
 <div className="chat-file-review-fields">{requiredFields(basis).map(field=><label key={field}>{FIELD_LABELS[field]}<select value={mapping[field]??""} onChange={e=>{const next={...mapping};if(e.target.value==="")delete next[field];else next[field]=Number(e.target.value);choose({mapping:next});}}><option value="">Choose a column…</option>{table.headers.map((header,i)=><option key={i} value={i}>{i+1}. {header||"Unnamed column"}</option>)}</select></label>)}</div>
 <p>Values must be customs values in USD. Retail prices, invoice totals and foreign currencies are not converted or assumed.</p>
 <div className="chat-file-review-table"><table><thead><tr>{table.headers.map((h,i)=><th key={i}>{h||`Column ${i+1}`}</th>)}</tr></thead><tbody>{table.sampleRows.map((row,i)=><tr key={i}>{table.headers.map((_,j)=><td key={j}>{row[j]??""}</td>)}</tr>)}</tbody></table></div>
 <small>First {table.sampleRows.length} of {table.totalRows.toLocaleString()} rows. The check reads every selected row. <a href={`/api/files/uploads/${file.uploadId}`}>Download original</a></small>
 {!!table.issues.length&&<p>{table.issues.join(" ")}</p>}
 <button type="button" className="btn" disabled={requiredFields(basis).some(f=>mapping[f]===undefined)||new Set(Object.values(mapping)).size!==Object.values(mapping).length} onClick={()=>{onChange({...file,mapping,basis,mappingConfirmed:true,skipCheck:false});setOpen(false);}}>Use these columns</button><button type="button" className="btn" onClick={()=>{onChange({...file,skipCheck:true});setOpen(false);}}>Ask about this file instead</button>
 </div>}
 </section>;
}
