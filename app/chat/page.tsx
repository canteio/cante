import { ChatPanel } from "@/components/chat/chat-panel";
import { Sidebar } from "@/components/dashboard/sidebar";
import { getDefaultCustomerId } from "@/lib/db/queries";
import { normalizeJurisdiction } from "@/lib/countries";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ conversationId?: string; country?: string }>;
}) {
  const customerId = await getDefaultCustomerId();
  const params = await searchParams;
  const conversationId = params.conversationId ?? null;
  const jurisdiction = normalizeJurisdiction(params.country);

  return (
    <div className="shell">
      <Sidebar active="chat" activeConversationId={conversationId} jurisdiction={jurisdiction} />
      <ChatPanel customerId={customerId} initialConversationId={conversationId} initialCountry={jurisdiction} />
    </div>
  );
}
