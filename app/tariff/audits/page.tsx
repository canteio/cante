import Link from "next/link";
import { Sidebar } from "@/components/dashboard/sidebar";
import { BusinessImpactPanel } from "@/components/tariff/business-impact-panel";

export const dynamic = "force-dynamic";

export default function Page() {
  return <div className="shell"><Sidebar active="tariff-audits" /><main className="main"><div className="main-scroll tariff-dashboard"><Link className="tariff-text-button" href="/tariff">← Your import duties</Link><div className="page-head"><div><h1>Historical audits</h1><p className="page-sub">Compare duty paid with supported calculations. Broker entry records required.</p></div></div><BusinessImpactPanel monitoring={false} /></div></main></div>;
}
