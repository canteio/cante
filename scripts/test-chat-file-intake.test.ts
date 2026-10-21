import test from "node:test";
import assert from "node:assert/strict";
import { zipSync,strToU8 } from "fflate";
import { extractTextFromFile } from "../lib/documents/extract-file";
import { fileTables,tablePreviews,canonicalTableCsv } from "../app/api/files/tabular";
import { parseLiveProducts } from "../app/api/tariff/live-check/check";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import ts from "typescript";
const headers=["sku","hts_code","origin_country","annual_customs_value_usd"];
const row=["QA-FILE","8501314000","CN","1000.00"];
const xml=(s:string)=>s.replaceAll("&","&amp;").replaceAll("<","&lt;");
function xlsx(rows:string[][],extraSheet=false){const files:Record<string,Uint8Array>={};for(let sheet=1;sheet<=(extraSheet?2:1);sheet++)files[`xl/worksheets/sheet${sheet}.xml`]=strToU8(`<worksheet><sheetData>${rows.map((row,i)=>`<row>${row.map((v,j)=>`<c r="${String.fromCharCode(65+j)}${i+1}" t="inlineStr"><is><t>${xml(v)}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`);return zipSync(files);}
function docx(rows:string[][]){return zipSync({"word/document.xml":strToU8(`<w:document xmlns:w="urn:w"><w:body><w:tbl>${rows.map(r=>`<w:tr>${r.map(c=>`<w:tc><w:p><w:r><w:t>${xml(c)}</w:t></w:r></w:p></w:tc>`).join("")}</w:tr>`).join("")}</w:tbl></w:body></w:document>`)});}
function pdf(rows:string[][]){const stream=rows.flatMap((row,i)=>row.map((v,j)=>`BT /F1 8 Tf ${[40,160,290,380][j]} ${740-i*20} Td (${v.replace(/[()\\]/g,"\\$&")}) Tj ET`)).join("\n");const objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];let body="%PDF-1.4\n";const offsets=[0];objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(body));body+=`${i+1} 0 obj\n${obj}\nendobj\n`;});const xref=Buffer.byteLength(body);body+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(v=>String(v).padStart(10,"0")+" 00000 n \n").join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return new Uint8Array(Buffer.from(body));}
for(const [filename,bytes] of [["products.csv",strToU8([headers,row].map(r=>r.join(",")).join("\n"))],["products.xlsx",xlsx([headers,row])],["products.docx",docx([headers,row])]] as const){
 test(`${filename} clear table becomes the same complete deterministic check input`,async()=>{
  const extracted=await extractTextFromFile(filename,bytes);const tables=fileTables(extracted);const preview=tablePreviews(tables)[0];assert(preview.ready);
  const normalized=canonicalTableCsv(tables,0);const products=parseLiveProducts(normalized.csv);assert.equal(products.length,1);assert.equal(products[0].sku,"QA-FILE");assert.equal(products[0].customsValue,1000);
 });
}
test("PDF positioned cells preserve the table and require explicit review",async()=>{
 const extracted=await extractTextFromFile("products.pdf",pdf([headers,row]));const tables=fileTables(extracted);const preview=tablePreviews(tables)[0];assert(preview,"PDF table not found");assert(preview.requiresReview);assert(!preview.ready);
 assert.throws(()=>canonicalTableCsv(tables,0),/Review and confirm/);
 const normalized=canonicalTableCsv(tables,0,preview.mapping,preview.basis,true);assert.equal(parseLiveProducts(normalized.csv)[0].customsValue,1000);
});
test("sparse spreadsheet cells do not shift money into the origin column",async()=>{
 const sheet='<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>sku</t></is></c><c r="B1" t="inlineStr"><is><t>hts_code</t></is></c><c r="C1" t="inlineStr"><is><t>origin_country</t></is></c><c r="D1" t="inlineStr"><is><t>annual_customs_value_usd</t></is></c></row><row><c r="A2" t="inlineStr"><is><t>QA-SPARSE</t></is></c><c r="B2"><v>8501314000</v></c><c r="D2"><v>1000</v></c></row></sheetData></worksheet>';
 const extracted=await extractTextFromFile("sparse.xlsx",zipSync({"xl/worksheets/sheet1.xml":strToU8(sheet)}));const tables=fileTables(extracted);assert.equal(tables[0].rows[1][2],"");assert.throws(()=>parseLiveProducts(canonicalTableCsv(tables,0).csv),/origin/);
});
test("currency decorations and embedded commas are preserved until deterministic USD normalization",async()=>{
 const extracted=await extractTextFromFile("products.xlsx",xlsx([headers,[...row.slice(0,3),"$1,234.56 USD"]]));const tables=fileTables(extracted);assert.equal(parseLiveProducts(canonicalTableCsv(tables,0).csv)[0].customsValue,1234.56);
 tables[0].rows[1][3]="CAD 1,234.56";assert.throws(()=>canonicalTableCsv(tables,0),/currencies are never converted/);
});
test("multiple sheets and ambiguous Price headers cannot auto-run",async()=>{
 const tables=fileTables(await extractTextFromFile("sheets.xlsx",xlsx([headers,row],true)));assert(!tablePreviews(tables)[0].ready);assert.throws(()=>canonicalTableCsv(tables,0),/Review and confirm/);
 const ambiguous=fileTables(await extractTextFromFile("price.xlsx",xlsx([[...headers.slice(0,3),"Price"],row])));const preview=tablePreviews(ambiguous)[0];assert(!preview.ready);assert.equal(preview.mapping.annual_customs_value_usd,undefined);
 const mapping={...preview.mapping,annual_customs_value_usd:3};assert.throws(()=>canonicalTableCsv(ambiguous,0,mapping,"annual",false),/Confirm/);assert.equal(parseLiveProducts(canonicalTableCsv(ambiguous,0,mapping,"annual",true).csv)[0].customsValue,1000);
});
test("selected unit basis cannot silently reuse a mapped annual total",()=>{
 const tables=[{label:"fixture",rows:[ [...headers,"unit_customs_value_usd","annual_import_units"],[...row,"2.00","5"] ],requiresReview:false,issues:[]}];const preview=tablePreviews(tables)[0];const csv=canonicalTableCsv(tables,0,preview.mapping,"units",true).csv;assert(!csv.split("\n")[0].includes("annual_customs_value_usd"));assert.equal(parseLiveProducts(csv)[0].customsValue,10);
});
test("a near-15 MiB ledger is read fully beyond the prompt preview without annualizing it",()=>{
 const csv="entry_id,line_number,entry_date,sku,hts_code,origin_country,customs_value_usd,supplier_note\n"+Array.from({length:6000},(_,i)=>`E-${i},1,2026-09-15,QA-${i%50},8501314000,CN,1000.00,${"x".repeat(2450)}`).join("\n");assert(Buffer.byteLength(csv)>14*1024*1024);assert(Buffer.byteLength(csv)<15*1024*1024);
 const tables=fileTables({text:csv,format:"csv",warnings:[]},csv);const normalized=canonicalTableCsv(tables,0);assert.equal(normalized.preview.totalRows,6000);const products=parseLiveProducts(normalized.csv);assert.equal(products.length,50);assert.equal(products[49].history?.entries.length,120);assert.equal(products[49].customsValue,120000);
});
test("original-file reassembly checks workspace, chunk count and SHA before parsing",async()=>{
 const bytes=Buffer.alloc(15*1024*1024,97);const file={id:"12345678-1234-4234-8234-123456789abc",customer_id:"tenant",size_bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex"),filename:"fixture.csv"};let corrupt=false,missing=false;const scopes:string[]=[];
 const db={from(table:string){const args:any={};const chain:any={select:()=>chain,eq:(k:string,v:any)=>{args[k]=v;if(k==="customer_id")scopes.push(v);return chain;},maybeSingle:async()=>({data:table==="chat_file_uploads"?file:missing?null:{body:(corrupt?Buffer.alloc(1024*1024,98):bytes.subarray(args.part*1024*1024,(args.part+1)*1024*1024)).toString("base64")},error:null})};return chain;}};
 const compiled=ts.transpileModule(readFileSync("app/api/files/upload-store.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const api:any={};runInThisContext(`(function(require,exports){${compiled}\n})`)((id:string)=>id==="node:crypto"?{createHash}:id==="@/lib/supabase/server"?{createRequestClient:async()=>db}:id==="@/lib/tariff/business-impact-store"?{isArchiveId:()=>true}:(()=>{throw Error(id);})(),api);
 assert.equal((await api.readOriginalUpload("tenant",file.id)).bytes.length,15*1024*1024);assert(scopes.every(s=>s==="tenant"));corrupt=true;await assert.rejects(()=>api.readOriginalUpload("tenant",file.id),/checksum/);corrupt=false;missing=true;await assert.rejects(()=>api.readOriginalUpload("tenant",file.id),/incomplete/);
});

function loaded(path:string,deps:Record<string,unknown>){const code=ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const exports:any={};runInThisContext(`(function(require,exports){${code}\n})`)((name:string)=>{assert(name in deps,`Unexpected dependency ${name}`);return deps[name];},exports);return exports;}
test("actual client upload, chunk handlers, extraction and preparation preserve the original across all four formats",async()=>{
 const {randomUUID}=await import("node:crypto");const bodyLimits=await import("../app/api/request-body");const {isArchiveId,sanitizeImpactFilename}=await import("../lib/tariff/business-impact-store");const tabular=await import("../app/api/files/tabular");const parsers=await import("../lib/documents/extract-file");const contract=await import("../lib/documents/files-extract-contract");
 const uploads:any[]=[];const chunks:any[]=[];const scopes:string[]=[];const transport:number[]=[];
 const workspace={customerId:"owned",userId:"owner",role:"owner"};
 const db={from(table:string){const filters:Record<string,unknown>={};const values=()=>table==="chat_file_uploads"?uploads:chunks;const query:any={select:()=>query,eq:(k:string,v:unknown)=>{filters[k]=v;if(k==="customer_id")scopes.push(String(v));return query;},order:()=>query,limit:()=>query,maybeSingle:async()=>({data:values().find(row=>Object.entries(filters).every(([k,v])=>row[k]===v))??null,error:null}),insert:async(row:any)=>{if(table==="chat_file_chunks"&&chunks.some(c=>c.upload_id===row.upload_id&&c.part===row.part))return {error:{code:"23505"}};values().push(table==="chat_file_uploads"?{...row,actor_id:workspace.userId,created_at:"2026-10-20T12:00:00Z"}:row);return {error:null};},then:(resolve:Function)=>resolve({data:values().filter(row=>Object.entries(filters).every(([k,v])=>row[k]===v)),error:null})};return query;}};
 const server={createRequestClient:async()=>db,getAuthenticatedWorkspace:async()=>workspace};
 const limiter={withRequestLimit:async(request:Request,_op:string,max:number,handler:Function)=>handler(await bodyLimits.boundedRequest(request,max))};
 const store=loaded("app/api/files/upload-store.ts",{"node:crypto":{createHash},"@/lib/supabase/server":server,"@/lib/tariff/business-impact-store":{isArchiveId}});
 const init=loaded("app/api/files/uploads/route.ts",{"node:crypto":{randomUUID},"@/app/api/request-limits":limiter,"@/lib/supabase/server":server,"@/lib/tariff/business-impact-store":{sanitizeImpactFilename},"../upload-store":store});
 const parts=loaded("app/api/files/uploads/[id]/route.ts",{"@/app/api/request-limits":limiter,"@/lib/supabase/server":server,"@/lib/tariff/business-impact-store":{isArchiveId},"../../upload-store":store});
 const extract=loaded("app/api/files/extract/route.ts",{"@/app/api/request-limits":limiter,"@/lib/documents/extract-file":parsers,"@/lib/supabase/server":server,"@/lib/tariff/business-impact-store":{isArchiveId},"../upload-store":store,"../tabular":tabular,"@/lib/documents/files-extract-contract":contract});
 const prepare=loaded("app/api/files/prepare-chat-upload.ts",{"./upload-store":store,"@/lib/documents/extract-file":parsers,"./tabular":tabular});
 const upload=loaded("components/chat/upload-file.ts",{}).uploadChatFile;
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(input:any,options:any)=>{const request=new Request(new URL(input,"https://cante.test"),options);const path=new URL(request.url).pathname;if(request.method==="PUT")transport.push((await request.clone().arrayBuffer()).byteLength);if(path==="/api/files/uploads")return init.POST(request);if(path==="/api/files/extract")return extract.POST(request);const id=path.split("/").pop();return parts.PUT(request,{params:Promise.resolve({id})});};
 try{
  for(const [filename,bytes] of [["catalogue.csv",strToU8([headers,row].map(r=>r.join(",")).join("\n"))],["catalogue.xlsx",xlsx([headers,row])],["catalogue.docx",docx([headers,row])],["catalogue.pdf",pdf([headers,row])]] as const){
   const file=new File([new Uint8Array(bytes)],filename);const result=await upload(file,()=>{});assert(result.uploadId);assert.equal(result.originalCsv,undefined);assert(JSON.stringify(result).length<30000);
   const preview=result.tables[0];result.text="Client preview says 999999 USD";preview.sampleRows[0][3]="999999";const outcome=await prepare.prepareChatUpload("owned",{...result,...(filename.endsWith("pdf")?{mapping:preview.mapping,basis:preview.basis,mappingConfirmed:true}:{})});
   assert(outcome.csv);assert.equal(parseLiveProducts(outcome.csv.originalCsv)[0].customsValue,1000);assert.equal(outcome.csv.sourceUpload.sha256,createHash("sha256").update(bytes).digest("hex"));
   const download=await parts.GET(new Request(`https://cante.test/api/files/uploads/${result.uploadId}`),{params:Promise.resolve({id:result.uploadId})});assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),Buffer.from(bytes));
  }
  assert(transport.every(n=>n<=1024*1024));assert(scopes.every(s=>s==="owned"));
 }finally{globalThis.fetch=originalFetch;}
});
