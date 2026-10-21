import { createRequestClient, getAuthenticatedWorkspace } from "@/lib/supabase/server";
export type RequestOperation = "chat" | "check" | "upload" | "upload_chunk" | "calculate";
import { RequestLimitError, boundedRequest } from "./request-body";
export { RequestLimitError, boundedRequest } from "./request-body";
export async function reserveRequest(operation: RequestOperation, customerId?: string) {
  try {
  const workspace = await getAuthenticatedWorkspace(customerId);
  if (!workspace) throw new RequestLimitError("Authentication and workspace access required.", 401);
  const db = await createRequestClient();
  const { data, error } = await db.rpc("acquire_api_request", { target_customer_id: workspace.customerId, operation_name: operation });
  if (error || !data || typeof data.allowed !== "boolean") throw new RequestLimitError("Request limits are unavailable. Please retry shortly.", 503);
  if (!data.allowed) throw new RequestLimitError(data.reason || "Request limit reached.", 429, Math.min(86400, Math.max(1, Math.ceil(Number(data.retryAfter) || 60))));
  if (typeof data.leaseId !== "string") throw new RequestLimitError("Request limits are unavailable.", 503);
  let released = false;
  const release = async () => {
    if (released) return; released = true;
    try { const result = await db.rpc("release_api_request", { lease_id: data.leaseId }); if (result.error) console.warn("Request lease release failed; it will expire."); }
    catch { console.warn("Request lease release failed; it will expire."); }
  };
  return Object.assign(release, { customerId: workspace.customerId });
  } catch (error) {
    if (error instanceof RequestLimitError) throw error;
    throw new RequestLimitError("Authentication or request limits are unavailable. Please retry shortly.", 503);
  }
}
export async function withRequestLimit(request: Request, operation: RequestOperation, limit: number, handler: (request: Request) => Promise<Response>) {
  let release: Awaited<ReturnType<typeof reserveRequest>> | undefined;
  try {
    release = await reserveRequest(operation);
    request = new Request(request, {signal: AbortSignal.any([request.signal, AbortSignal.timeout(operation === "upload" ? 55_000 : 280_000)])});
    const bounded = await boundedRequest(request, limit);
    // Resolve customer selectors through verified membership too. A user belonging
    // to several workspaces must not charge one workspace while operating in another.
    const path = new URL(request.url).pathname;
    let selected: unknown;
    if (["/api/chat", "/api/products", "/api/classifications/suggest"].includes(path)) {
      try {
        if (request.headers.get("content-type")?.includes("multipart/form-data")) selected = (await bounded.clone().formData()).get("customerId");
        else selected = (await bounded.clone().json()).customerId;
      } catch { /* The handler returns its existing format-validation error. */ }
    }
    if (typeof selected === "string" && selected && selected !== release.customerId) {
      await release();
      release = undefined;
      release = await reserveRequest(operation, selected);
    }
    const response = await handler(bounded);
    if (response.body && /text\/event-stream|application\/(?:x-ndjson|octet-stream)/.test(response.headers.get("content-type") ?? "")) {
      const reader = response.body.getReader(); const finish = release; release = undefined; let cancelled = false;
      return new Response(new ReadableStream({
        async pull(controller) {
          try { const chunk = await reader.read(); if (chunk.done) { if (!cancelled) { await finish(); controller.close(); } } else if (!cancelled) controller.enqueue(chunk.value); }
          catch (error) { if (!cancelled) { if (!request.signal.aborted) await finish(); controller.error(error); } }
        },
        // Keep the lease on disconnect: work may still be unwinding in the handler.
        // Otherwise repeatedly disconnecting would bypass the concurrent-operation cap.
        async cancel(reason) { cancelled = true; await reader.cancel(reason).catch(() => {}); },
      }), { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    return response;
  } catch (error) {
    if (error instanceof RequestLimitError) return Response.json({ error: error.message }, { status: error.status, headers: { "cache-control": "no-store", ...(error.status === 429 ? { "retry-after": String(error.retryAfter) } : {}) } });
    if (request.signal.aborted) return Response.json({error:"Request cancelled or timed out."},{status:408});
    throw error;
  } finally { await release?.(); }
}
