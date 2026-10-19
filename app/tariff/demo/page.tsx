import { Sidebar } from "@/components/dashboard/sidebar";
import { LiveCheckPanel } from "@/components/tariff/live-check-panel";
export const dynamic = "force-dynamic";
export default function TariffDemoPage() {
  return <div className="shell"><Sidebar active="tariff" /><main className="main"><LiveCheckPanel /></main></div>;
}
