import { redirect } from "next/navigation";

export default async function RootPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string; conversationId?: string }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (params.country) query.set("country", params.country);
  if (params.conversationId) query.set("conversationId", params.conversationId);
  const qStr = query.toString();
  redirect(`/chat${qStr ? `?${qStr}` : ""}`);
}
