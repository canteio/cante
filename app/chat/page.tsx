import { ChatPanel } from "@/components/chat/chat-panel";
import { Sidebar } from "@/components/dashboard/sidebar";
import { getDefaultCustomerId } from "@/lib/db/queries";


export const dynamic = "force-dynamic";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ conversationId?: string; country?: string; demo?: string }>;
}) {
  const customerId = await getDefaultCustomerId();
  const params = await searchParams;
  const conversationId = params.conversationId ?? null;
  const jurisdiction = "United States"; // Temporary U.S.-only chat; ignore old country links.

  return (
    <div className="shell">
      <Sidebar active="chat" activeConversationId={conversationId} jurisdiction={jurisdiction} />
      <ChatPanel customerId={customerId} initialConversationId={conversationId} initialCountry={jurisdiction} initialDemo={params.demo === "equipment"} />
    </div>
  );
}
