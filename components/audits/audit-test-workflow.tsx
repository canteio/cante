"use client";
import { useMemo, useRef, useState } from "react";
import { AuditTestContext, AuditUpload, AuditDetail, type Detail, type Preview, type AuditTestTransport } from "./audit-workspace";
import { type AuditOptions, type Mapping, type FactDecision } from "@/app/api/audits/model";

type RunInput={csv:string;filename:string;mapping?:Mapping;options:AuditOptions;reviews:FactDecision[]};
type Answer={preview:Preview;products:{id:string;sku:string;name:string}[];detail?:Detail;csv?:string};
export function AuditTestWorkflow(){
  const [auditId,setAuditId]=useState<string|null>(null),[generation,setGeneration]=useState(0),[error,setError]=useState(""),[loading,setLoading]=useState(false);
  const files=useRef(new Map<string,File>()), saved=useRef<RunInput|null>(null), detail=useRef<Detail|null>(null), report=useRef(""), products=useRef<Answer["products"]>([]);
  const response=(data:unknown,status=200)=>Response.json(data,{status});
  async function compute(input:RunInput,action:"preview"|"run"):Promise<Answer>{
    const result=await fetch("/audit-test/run",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...input,action})});
    const data=await result.json();if(!result.ok)throw Error(data.error??"Test unavailable.");return data;
  }
  function saveAnswer(answer:Answer){products.current=answer.products;if(answer.detail){detail.current=answer.detail;report.current=answer.csv??"";}}
  const transport=useMemo<AuditTestTransport>(()=>({
    async upload(file,progress){if(file.size>2*1024*1024)throw Error("Use a test file up to 2 MiB.");const id=crypto.randomUUID();files.current.set(id,file);progress("Test file held in this tab only.");return id;},
    navigate(id){setAuditId(id);},
    async exportReport(){if(!report.current)throw Error("Run the test audit first.");download(report.current,"SYNTHETIC-audit-test-report.csv");},
    async request(url,init){try{
      const path=new URL(url,window.location.origin);
      if(path.pathname==="/api/audits/products")return response({products:products.current.filter(p=>p.sku.startsWith(path.searchParams.get("search")??"")).slice(0,20)});
      if(path.pathname==="/api/audits"&&init?.method==="POST"){
        const body=JSON.parse(String(init.body)),file=files.current.get(body.uploadId);if(!file)throw Error("Choose the test CSV again.");
        const input:RunInput={csv:await file.text(),filename:file.name,mapping:body.mapping,options:body.options,reviews:[]};
        const answer=await compute(input,"preview");saveAnswer(answer);
        if(body.action==="preview")return response(answer.preview);
        if(body.action!=="create"||body.mappingConfirmed!==true)throw Error("Confirm the test mapping first.");
        saved.current=input;detail.current={batch:{id:"test-session",filename:file.name,created_at:new Date().toISOString(),status:"pending",revision:0,progress:0,summary:null},rows:[],decisions:[],history:[],verified:false,stale:false,summary:null,canWrite:true};
        return response({id:"test-session"});
      }
      if(!saved.current||!detail.current)throw Error("Upload and confirm a CSV first.");
      if(path.pathname.endsWith("/run")){
        const answer=await compute(saved.current,"run");saveAnswer(answer);
        return new Response(JSON.stringify({type:"done"})+"\n",{headers:{"content-type":"application/x-ndjson"}});
      }
      if(path.pathname.endsWith("/reviews")){
        const decision=JSON.parse(String(init?.body)) as FactDecision;
        if(!detail.current.verified)throw Error("Run this test revision first.");
        const next={...saved.current,reviews:[...saved.current.reviews,decision]};
        const answer=await compute(next,"run");saved.current=next;saveAnswer(answer);
        if(decision.kind==="confirm_facts"){
          detail.current={...detail.current!,verified:false,summary:null,rows:[],batch:{...detail.current!.batch,status:"pending",summary:null,progress:0}};report.current="";
        }
        return response({saved:true});
      }
      if(path.pathname==="/api/audits/test-session")return response(detail.current);
      throw Error("This test cannot read or write workspace data.");
    }catch(e){return response({error:e instanceof Error?e.message:"Test unavailable."},400);}}
  // Refs hold only this temporary tab's input/results; no persistent workspace.
  }),[]);
  async function sample(){setLoading(true);setError("");try{const r=await fetch("/audit-test/run"),data=await r.json();if(!r.ok)throw Error("Test sample unavailable.");download(data.csv,data.filename);}catch(e){setError(e instanceof Error?e.message:"Sample unavailable.");}finally{setLoading(false);}}
  function reset(){files.current.clear();saved.current=null;detail.current=null;report.current="";products.current=[];setAuditId(null);setGeneration(n=>n+1);window.history.replaceState(null,"","/audit-test");}
  return <AuditTestContext.Provider value={transport}><div className="audit-test-banner" role="note"><div><strong>LOCAL WORKFLOW TEST · APPROVAL SKIPPED FOR FICTIONAL RULES</strong><p>120 fictional entries. No human approval required here. Customer audits keep their approval checks; nothing in this test is saved to your workspace.</p></div><div className="audit-actions"><button className="btn" disabled={loading} onClick={()=>void sample()}>Download test CSV</button><button className="btn" onClick={reset}>Start over</button></div></div>{error&&<p className="audit-error" role="alert">{error}</p>}{auditId?<AuditDetail key={`${generation}:${auditId}`} id={auditId}/>:<AuditUpload key={generation}/>}</AuditTestContext.Provider>;
}
function download(csv:string,filename:string){const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));const link=document.createElement("a");link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
