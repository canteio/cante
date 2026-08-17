import { SuppliersPanel } from "@/components/suppliers/suppliers-panel";
import { Sidebar } from "@/components/dashboard/sidebar";
import { normalizeJurisdiction } from "@/lib/countries";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  const params = await searchParams;
  const jurisdiction = normalizeJurisdiction(params.country);
  return (
    <div className="shell">
      <Sidebar active="suppliers" jurisdiction={jurisdiction} />
      <main className="main">
        <SuppliersPanel country={jurisdiction} />
      </main>
    </div>
  );
}
