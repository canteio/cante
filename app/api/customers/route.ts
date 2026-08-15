import { NextResponse } from "next/server";
import { listCustomers, listSources } from "@/lib/db/queries";
import { getProvider } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const provider = getProvider();
  return NextResponse.json({
    customers: await listCustomers(),
    sources: await listSources(),
    llm: { provider: provider.name, ...(await provider.available()) },
  });
}
