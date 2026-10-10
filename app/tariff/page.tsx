import { Sidebar } from "@/components/dashboard/sidebar";
import { BusinessImpactPanel } from "@/components/tariff/business-impact-panel";
// MVP: MissionOneHub showed a "Critical Regulatory Action Detected" banner
// computed from a hardcoded fake catalogue (ENG-ROTOR-01 etc.) and a notice
// that silently falls back to canned data on any fetch failure, presented
// with total confidence either way. Disabled rather than deleted — see
// CLAUDE.md's "Mission One rollback" entry before re-enabling it.
// import { MissionOneHub } from "@/components/tariff/mission-one-hub";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="shell">
      <Sidebar active="tariff" />
      <main className="main">
        <div className="main-scroll" style={{ padding: "1.5rem" }}>
          <BusinessImpactPanel />
          {/* <MissionOneHub /> */}
        </div>
      </main>
    </div>
  );
}
