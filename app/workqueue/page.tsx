import { WorkQueuePanel } from "@/components/workqueue/workqueue-panel";
import { Sidebar } from "@/components/dashboard/sidebar";
import { normalizeJurisdiction } from "@/lib/countries";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  const params = await searchParams;
  const jurisdiction = normalizeJurisdiction(params.country);
  return (
    <div className="shell">
      <Sidebar active="workqueue" jurisdiction={jurisdiction} />
      <main className="main">
        <WorkQueuePanel country={jurisdiction} />
      </main>
    </div>
  );
}
