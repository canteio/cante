import { NextResponse } from "next/server";
import { createClient, getAuthenticatedWorkspace } from "@/lib/supabase/server";
import { supabaseMonitorStore } from "@/pipelines/import-manifest/monitor/store";
import { respondToMonitorQuery } from "@/pipelines/import-manifest/monitor/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Auth is repeated here as well as middleware. Tenant IDs are never accepted
 * from query parameters; hosted reads use the publishable user/RLS session. */
// Route-handler error audit (2026-09-16, continued): this endpoint had no
// try/catch, so a DB/provider failure (session lookup, store.read) fell
// through to Next's generic HTML error page instead of clean JSON — unusable
// for an AI agent client, which expects a parseable {error} body on every
// status. Wrapped to match app/api/customers/route.ts's fix from this sweep.
export async function GET(request: Request) {
  try {
    const customerId = (await getAuthenticatedWorkspace())?.customerId ?? null;
    return await respondToMonitorQuery(request, customerId, async id => {
      const store = supabaseMonitorStore(await createClient());
      return store.read(id);
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load import monitor data." },
      { status: 500 },
    );
  }
}
