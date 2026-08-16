import { ChecklistPanel } from "@/components/checklist/checklist-panel";
import { Sidebar } from "@/components/dashboard/sidebar";

export const dynamic = "force-dynamic";

export default function ChecklistPage() {
  return (
    <div className="shell">
      <Sidebar active="checklist" />
      <main className="main">
        <ChecklistPanel />
      </main>
    </div>
  );
}
