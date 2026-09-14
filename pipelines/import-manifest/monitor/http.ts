import type { MonitorState } from "./model";
import { monitorQuery, monitorQueryDocs, searchMonitor } from "./query";

/** Shared HTTP boundary keeps validation and tenant selection testable without
 * a running Next server. Only the route's verified workspace ID is trusted. */
export async function respondToMonitorQuery(
  request: Request,
  customerId: string | null,
  readState: (customerId: string) => Promise<MonitorState | null>,
) {
  const headers = { "Cache-Control": "private, no-store" };
  // params doc is included on both error paths below: an agent hitting this
  // endpoint cold (no session, or guessed params) can self-correct from the
  // error body alone rather than needing to find README/source first.
  if (!customerId) return Response.json({ error: "Workspace authentication required.", params: monitorQueryDocs }, { status: 401, headers });
  const parsed = monitorQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "Invalid query parameters", issues: parsed.error.flatten(), params: monitorQueryDocs }, { status: 400, headers });
  try {
    return Response.json(searchMonitor(await readState(customerId), parsed.data), { headers });
  } catch (error) {
    console.error("Import monitor read failed", error);
    // params doc was missing on this one error path (401/400/200 all include
    // it already) — an agent that got a valid request past validation and
    // then hit a transient 503 had no way to tell "your params were fine,
    // retry the same request" from "go re-derive the contract from scratch".
    // Retryable is explicit too, since 503 here is a storage outage, not a
    // client error the agent should try to fix before retrying.
    return Response.json({ error: "Import monitoring storage is unavailable.", retryable: true, params: monitorQueryDocs }, { status: 503, headers });
  }
}
