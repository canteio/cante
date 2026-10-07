import { Sidebar } from "@/components/dashboard/sidebar";
import { TariffStackPanel } from "@/components/tariff/tariff-stack-panel";
import { BusinessImpactPanel } from "@/components/tariff/business-impact-panel";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="shell">
      <Sidebar active="tariff" />
      <main className="main">
        <div className="main-scroll">
          <BusinessImpactPanel />
          <TariffStackPanel embedded />
        </div>
      </main>
    </div>
  );
}
