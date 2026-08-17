import { DocumentsPanel } from "@/components/documents/documents-panel";
import { Sidebar } from "@/components/dashboard/sidebar";
import { normalizeJurisdiction } from "@/lib/countries";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  const params = await searchParams;
  const jurisdiction = normalizeJurisdiction(params.country);
  return (
    <div className="shell">
      <Sidebar active="documents" jurisdiction={jurisdiction} />
      <main className="main">
        <DocumentsPanel country={jurisdiction} />
      </main>
    </div>
  );
}
