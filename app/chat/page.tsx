import { ChatPanel } from "@/components/chat/chat-panel";
import { Sidebar } from "@/components/dashboard/sidebar";
import { getDefaultCustomerId } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ conversationId?: string }>;
}) {
  const customerId = await getDefaultCustomerId();
  const params = await searchParams;
  const conversationId = params.conversationId ?? null;

  return (
    <div className="shell">
      <Sidebar active="chat" activeConversationId={conversationId} />
      <ChatPanel customerId={customerId} initialConversationId={conversationId} />
    </div>
  );
}
