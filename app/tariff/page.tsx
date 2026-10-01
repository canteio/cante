import { Sidebar } from "@/components/dashboard/sidebar";
import { TariffStackPanel } from "@/components/tariff/tariff-stack-panel";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="shell">
      <Sidebar active="tariff" />
      <main className="main">
        <TariffStackPanel />
      </main>
    </div>
  );
}
