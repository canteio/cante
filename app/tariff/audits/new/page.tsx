import { Sidebar } from "@/components/dashboard/sidebar";
import { AuditUpload } from "@/components/audits/audit-workspace";
export const dynamic="force-dynamic";
export default function Page(){return <div className="shell tariff-shell"><Sidebar active="tariff-audits"/><main className="main"><div className="main-scroll"><AuditUpload/></div></main></div>;}
