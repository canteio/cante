import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { listCustomers, listSources } from "@/lib/db/queries";
import { getProvider, normalizeProviderChoice, PROVIDER_COOKIE } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const selectedProvider = normalizeProviderChoice((await cookies()).get(PROVIDER_COOKIE)?.value);
  const provider = getProvider(selectedProvider);
  return NextResponse.json({
    customers: await listCustomers(),
    sources: await listSources(),
    llm: { provider: provider.name, ...(await provider.available()) },
  });
}
