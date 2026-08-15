import { Sidebar } from "@/components/dashboard/sidebar";
import { MemoryPanel } from "@/components/memory/memory-panel";

export const dynamic = "force-dynamic";

export default function MemoryPage() {
  return (
    <div className="shell">
      <Sidebar active="memory" />
      <main className="main">
        <MemoryPanel />
      </main>
    </div>
  );
}
