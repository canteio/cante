import { getAuthenticatedWorkspace, isPlatformTariffReviewer } from "@/lib/supabase/server";
import { getAuthMode } from "@/lib/auth/config";
import { Sidebar } from "@/components/dashboard/sidebar";
import { ImportReviewHome } from "@/components/tariff/import-review-home";
// MVP: MissionOneHub showed a "Critical Regulatory Action Detected" banner
// computed from a hardcoded fake catalogue (ENG-ROTOR-01 etc.) and a notice
// that silently falls back to canned data on any fetch failure, presented
// with total confidence either way. Disabled rather than deleted — see
// CLAUDE.md's "Mission One rollback" entry before re-enabling it.
// import { MissionOneHub } from "@/components/tariff/mission-one-hub";

export const dynamic = "force-dynamic";

export default async function Page() {
  const workspace = getAuthMode() === "supabase" ? await getAuthenticatedWorkspace() : null;
  const canReviewRules = Boolean(workspace) && await isPlatformTariffReviewer();
  return (
    <div className="shell">
      <Sidebar active="tariff" />
      <main className="main">
        <ImportReviewHome canReviewRules={canReviewRules} />
        {/* <MissionOneHub /> */}
      </main>
    </div>
  );
}
