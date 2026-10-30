"use client";
import { useCallback,useEffect,useState } from "react";
import Link from "next/link";
type State={settings:null|{enabled:boolean;last_status:string;last_error:string|null;last_success_at:string|null;next_check_at:string};events:{id:string;check_id:string;title:string;created_at:string;kind:string}[];canManage:boolean};
export function DailyMonitor(){
 const [state,setState]=useState<State|null>(null),[error,setError]=useState(""),[saving,setSaving]=useState(false);
 const load=useCallback(async()=>{try{const response=await fetch("/api/tariff/monitor",{cache:"no-store"});const data=await response.json();if(!response.ok)throw Error(data.error);setState(data);setError("");}catch(e){setError(e instanceof Error?e.message:"Daily checks unavailable.");}},[]);
 useEffect(()=>{void load();window.addEventListener("focus",load);window.addEventListener("cante:workspace-updated",load);return()=>{window.removeEventListener("focus",load);window.removeEventListener("cante:workspace-updated",load);};},[load]);
 async function toggle(enabled:boolean){setSaving(true);try{const r=await fetch("/api/tariff/monitor",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({enabled})});const data=await r.json();if(!r.ok)throw Error(data.error);await load();}catch(e){setError(e instanceof Error?e.message:"Could not save setting.");}finally{setSaving(false);}}
 return <section className="workspace-daily" aria-label="Daily tariff checks">
  <div className="workspace-daily-setting"><label><input type="checkbox" checked={state?.settings?.enabled??false} disabled={!state?.canManage||saving} onChange={e=>void toggle(e.target.checked)}/> Check my saved products daily</label><span>{state?.settings?.enabled?(state.settings.last_status==="running"?"Checking official sources…":state.settings.last_success_at?`Last completed ${new Date(state.settings.last_success_at).toLocaleString()}`:"First check queued"):"Turn on for in-app updates"}</span></div>
  {(error||state?.settings?.last_error)&&<p role="status" className="workspace-daily-error">{error||state?.settings?.last_error}</p>}
  {!!state?.events.length&&<details><summary>{state.events.length} recent update{state.events.length===1?"":"s"}</summary><ul>{state.events.map(event=><li key={event.id}><Link href={`/tariff?check=${event.check_id}`}>{event.title}</Link><time dateTime={event.created_at}>{new Date(event.created_at).toLocaleDateString()}</time></li>)}</ul></details>}
 </section>;
}
