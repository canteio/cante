import { Sidebar } from "@/components/dashboard/sidebar";
import { MissionOneHub } from "@/components/tariff/mission-one-hub";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="shell">
      <Sidebar active="tariff" />
      <main className="main">
        <div className="main-scroll" style={{ padding: "1.5rem" }}>
          <MissionOneHub />
        </div>
      </main>
    </div>
  );
}
