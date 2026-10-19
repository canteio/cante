import Link from "next/link";
import { getAuthenticatedWorkspace } from "@/lib/supabase/server";
import { Sidebar } from "@/components/dashboard/sidebar";
import { StackingRuleReview } from "@/components/tariff/stacking-rule-review";
export const dynamic = "force-dynamic";
export default async function RuleReviews() {
  const workspace = await getAuthenticatedWorkspace();
  const allowed = workspace?.role === "owner" || workspace?.role === "admin";
  return <div className="shell"><Sidebar active="tariff" /><main className="main"><div className="main-scroll"><Link href="/tariff">← Tariff dashboard</Link><div className="page-head"><div><h1>Rule reviews</h1><p className="page-sub">Admin · Source review is required before a draft changes calculations.</p></div></div>{allowed ? <StackingRuleReview /> : <p>Owner or admin access is required.</p>}</div></main></div>;
}
