import { Sidebar } from "@/components/dashboard/sidebar";
import { MemoryPanel } from "@/components/memory/memory-panel";
import { normalizeJurisdiction } from "@/lib/countries";

export const dynamic = "force-dynamic";

export default async function MemoryPage({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  const params = await searchParams;
  const jurisdiction = normalizeJurisdiction(params.country);
  return (
    <div className="shell">
      <Sidebar active="memory" jurisdiction={jurisdiction} />
      <main className="main">
        <MemoryPanel country={jurisdiction} />
      </main>
    </div>
  );
}
