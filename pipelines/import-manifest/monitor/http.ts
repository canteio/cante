import type { MonitorState } from "./model";
import { monitorQuery, searchMonitor } from "./query";

/** Shared HTTP boundary keeps validation and tenant selection testable without
 * a running Next server. Only the route's verified workspace ID is trusted. */
export async function respondToMonitorQuery(
  request: Request,
  customerId: string | null,
  readState: (customerId: string) => Promise<MonitorState | null>,
) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!customerId) return Response.json({ error: "Workspace authentication required." }, { status: 401, headers });
  const parsed = monitorQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "Invalid query parameters", issues: parsed.error.flatten() }, { status: 400, headers });
  try {
    return Response.json(searchMonitor(await readState(customerId), parsed.data), { headers });
  } catch (error) {
    console.error("Import monitor read failed", error);
    return Response.json({ error: "Import monitoring storage is unavailable." }, { status: 503, headers });
  }
}
