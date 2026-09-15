import { Sidebar } from "@/components/dashboard/sidebar";
import { ImportMonitorPanel } from "./panel";

export const dynamic = "force-dynamic";
export default function ImportMonitorPage() {
  return <div className="shell">
    <Sidebar active="import-monitor" jurisdiction="United States" />
    <main className="main"><div className="main-scroll"><div className="main-inner">
      <div className="page-head"><div><h1>Continuous import monitoring</h1>
        <p className="page-sub">Find U.S. importers with recent manifest activity and CPSC recall evidence.</p></div></div>
      <ImportMonitorPanel />
    </div></div></main>
  </div>;
}
