import { ChatPanel } from "@/components/chat/chat-panel";
import { Sidebar } from "@/components/dashboard/sidebar";
import { getDefaultCustomerId } from "@/lib/db/queries";


export const dynamic = "force-dynamic";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ conversationId?: string; country?: string; demo?: string; auditId?:string;auditRow?:string }>;
}) {
  const customerId = await getDefaultCustomerId();
  const params = await searchParams;
  const conversationId = params.conversationId ?? null;
  const jurisdiction = "United States"; // Temporary U.S.-only chat; ignore old country links.

  return (
    <div className="shell">
      <Sidebar active="chat" activeConversationId={conversationId} jurisdiction={jurisdiction} />
      <ChatPanel customerId={customerId} initialConversationId={conversationId} initialCountry={jurisdiction} initialDemo={params.demo === "equipment"} auditContext={params.auditId?{id:params.auditId,row:Number(params.auditRow)}:undefined} initialPrompt={params.auditId?"Explain this audit finding and the evidence I need next.":""}/>
    </div>
  );
}
