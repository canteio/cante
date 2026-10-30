import { Sidebar } from "@/components/dashboard/sidebar";
import { AuditDetail } from "@/components/audits/audit-workspace";
import { notFound } from "next/navigation";
import { isArchiveId } from "@/lib/tariff/business-impact-store";
export const dynamic="force-dynamic";
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;if(!isArchiveId(id))notFound();return <div className="shell tariff-shell"><Sidebar active="tariff-audits"/><main className="main"><div className="main-scroll"><AuditDetail id={id}/></div></main></div>;}
