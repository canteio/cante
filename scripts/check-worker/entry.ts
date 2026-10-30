import { runDailyMonitor } from "../../app/api/internal/tariff-live-check/daily";
import { POST } from "../../app/api/internal/tariff-live-check/route";
import { POST as audit } from "../../app/api/internal/tariff-audit/route";
import { withWorkerSession, withWorkerClient } from "./session";
/** Only this entry point is packaged into the separate Vercel worker project.
 * No website routes, browser bundle, CLI/model provider, schedule or delivery. */
export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "GET" && new URL(request.url).pathname === "/api/monitor") return runDailyMonitor(request, withWorkerClient);
    if (request.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
    if (process.env.CANTE_DEPLOYMENT_ROLE !== "trusted-check-worker") return Response.json({ error: "Worker deployment role required." }, { status: 409 });
    const authorization = request.headers.get("authorization") ?? "";
    if (!/^Bearer [A-Za-z0-9_.-]+$/.test(authorization)) return Response.json({ error: "Authentication required." }, { status: 401 });
    // POST verifies signature/body/session before any official-source work.
    try { return await withWorkerSession(authorization.slice(7), () => request.headers.get("x-cante-task")==="historical-audit" ? audit(request) : POST(request)); }
    catch { return Response.json({ error: "Worker authentication or storage unavailable." }, { status: 503 }); }
  },
};
