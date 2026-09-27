import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { listCustomers, listSources } from "@/lib/db/queries";
import { getProvider, normalizeProviderChoice, PROVIDER_COOKIE } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Route-handler error audit (2026-09-16): this endpoint had no try/catch,
  // so any failure (DB read, provider.available() probe) fell through to
  // Next's generic HTML error page instead of clean JSON — unusable for an
  // AI agent client, which expects a parseable {error} body on every status.
  try {
    const selectedProvider = normalizeProviderChoice(
      process.env.CANTE_LLM_LOCKED === "true"
        ? process.env.CANTE_LLM
        : (await cookies()).get(PROVIDER_COOKIE)?.value,
    );
    const provider = getProvider(selectedProvider);
    return NextResponse.json({
      customers: await listCustomers(),
      sources: await listSources(),
      llm: { provider: provider.name, ...(await provider.available()) },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load customers." },
      { status: 500 },
    );
  }
}
