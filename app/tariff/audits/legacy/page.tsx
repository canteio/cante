import Link from "next/link";
import { Sidebar } from "@/components/dashboard/sidebar";
import { BusinessImpactPanel } from "@/components/tariff/business-impact-panel";
export const dynamic="force-dynamic";
export default function Page(){return <div className="shell"><Sidebar active="tariff-audits"/><main className="main"><div className="main-scroll"><Link href="/tariff/audits">← Audits</Link><div className="page-head"><div><h1>Earlier historical snapshots</h1><p className="page-sub">Preserved original interface. These records are not retrospectively verified by the new audit worker.</p></div></div><BusinessImpactPanel monitoring={false}/></div></main></div>;}
