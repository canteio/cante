import { ChatPanel } from "@/components/chat/chat-panel";
import { Sidebar } from "@/components/dashboard/sidebar";
import { getDefaultCustomerId } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const customerId = await getDefaultCustomerId();

  return (
    <div className="shell has-rail">
      <Sidebar active="chat" />
      <ChatPanel customerId={customerId} />
    </div>
  );
}
