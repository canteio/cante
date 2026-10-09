import { CataloguePanel } from "@/components/catalogue/catalogue-panel";
import { Sidebar } from "@/components/dashboard/sidebar";
import { normalizeJurisdiction } from "@/lib/countries";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  const params = await searchParams;
  // MVP: Indonesian jurisdiction selection retained but disabled.
  // const jurisdiction = normalizeJurisdiction(params.country);
  const jurisdiction = "United States";
  return (
    <div className="shell">
      <Sidebar active="catalogue" jurisdiction={jurisdiction} />
      <main className="main">
        <CataloguePanel country={jurisdiction} />
      </main>
    </div>
  );
}
