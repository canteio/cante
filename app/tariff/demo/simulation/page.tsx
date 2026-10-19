import { Sidebar } from "@/components/dashboard/sidebar";
import { TariffDemoPanel } from "@/components/tariff/tariff-demo-panel";
export const dynamic = "force-dynamic";
export default function SimulationPage() {
  return <div className="shell"><Sidebar active="tariff" /><main className="main"><TariffDemoPanel /></main></div>;
}
