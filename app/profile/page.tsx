import { ComplianceProfilePanel } from "@/components/profile/compliance-profile-panel";
import { Sidebar } from "@/components/dashboard/sidebar";
import { normalizeJurisdiction } from "@/lib/countries";

export const dynamic = "force-dynamic";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  const params = await searchParams;
  const country = normalizeJurisdiction(params.country);
  return <div className="shell"><Sidebar active="profile" jurisdiction={country} /><main className="main"><ComplianceProfilePanel country={country} /></main></div>;
}
