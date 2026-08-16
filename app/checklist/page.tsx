import { ChecklistPanel } from "@/components/checklist/checklist-panel";
import { Sidebar } from "@/components/dashboard/sidebar";
import { normalizeJurisdiction } from "@/lib/countries";

export const dynamic = "force-dynamic";

export default async function ChecklistPage({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  const params = await searchParams;
  const jurisdiction = normalizeJurisdiction(params.country);
  return (
    <div className="shell">
      <Sidebar active="checklist" jurisdiction={jurisdiction} />
      <main className="main">
        <ChecklistPanel country={jurisdiction} />
      </main>
    </div>
  );
}
