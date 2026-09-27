import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuthMode, getDataBackend, DEMO_SESSION_COOKIE, DEMO_SESSION_VALUE } from "@/lib/auth/config";
import { createClient, getAuthenticatedWorkspace } from "@/lib/supabase/server";
import { sqliteMonitorStore, supabaseMonitorStore } from "@/pipelines/import-manifest/monitor/store";
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
    let customerId: string | null = null;
    if (getAuthMode() === "supabase") {
      customerId = (await getAuthenticatedWorkspace())?.customerId ?? null;
    } else if ((await cookies()).get(DEMO_SESSION_COOKIE)?.value === DEMO_SESSION_VALUE) {
      const { getDefaultCustomerId } = await import("@/lib/db/queries");
      customerId = await getDefaultCustomerId();
    }
    return await respondToMonitorQuery(request, customerId, async id => {
      const store = getDataBackend() === "supabase" ? supabaseMonitorStore(await createClient()) : await sqliteMonitorStore();
      return store.read(id);
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load import monitor data." },
      { status: 500 },
    );
  }
}
