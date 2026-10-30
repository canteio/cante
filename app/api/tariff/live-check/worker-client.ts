import {DUTY_CALCULATION_VERSION} from "@/lib/tariff/duty-expression";
import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { createRequestClient } from "@/lib/supabase/server";
import type { LiveCheckResult } from "./check";

export function checkWorkerConfigured() {
  return Boolean(process.env.CANTE_CHECK_WORKER_URL && (process.env.CANTE_CHECK_DISPATCH_SECRET?.length ?? 0) >= 32);
}
export function dispatchSignature(secret: string, timestamp: string, body: string, cookie: string) {
  return createHmac("sha256", secret).update(`${timestamp}\n${body}\n${cookie}`).digest("hex");
}
/** Only IDs and the authenticated session travel to a fixed operator-configured
 * worker. The worker reads immutable originals and fetches its own evidence. */
export async function dispatchCheck(checkId: string, customerId: string, signal: AbortSignal, progress: (message: string) => void): Promise<LiveCheckResult> {
  const target = new URL(process.env.CANTE_CHECK_WORKER_URL!);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
  if ((target.protocol !== "https:" && !(target.protocol === "http:" && local && !process.env.VERCEL)) || target.username || target.password || !["/api/internal/tariff-live-check", "/api/check"].includes(target.pathname) || target.search || target.hash) throw Error("Invalid check worker configuration.");
  const body = JSON.stringify({ checkId, customerId });
  let cookie = ""; let authorization = "";
  if (target.pathname === "/api/check") {
    const { data, error } = await (await createRequestClient()).auth.getSession();
    if (error || !data.session?.access_token) throw Error("Authenticated check session unavailable.");
    authorization = `Bearer ${data.session.access_token}`;
  } else cookie = (await cookies()).toString();
  const timestamp = Date.now().toString();
  const response = await fetch(target, { method: "POST", redirect: "error", cache: "no-store", signal, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(authorization ? { authorization } : {}), "x-cante-dispatched-at": timestamp, "x-cante-dispatch-signature": dispatchSignature(process.env.CANTE_CHECK_DISPATCH_SECRET!, timestamp, body, authorization || cookie) }, body });
  if (!response.ok || !response.body) throw Error("The checking worker is unavailable. No completed check is claimed.");
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = ""; let bytes = 0; const completion: {result: LiveCheckResult | null} = {result:null};
  const line = (text: string) => {
    if (!text.trim()) return;
    const event = JSON.parse(text);
    if (event.type === "error") throw Error("The trusted check could not finish or be verified. See check history for its status.");
    if (event.type === "progress" && typeof event.message === "string") progress(event.message);
    if (event.type === "done") {
      if (completion.result || event.checkId !== checkId || event.verified !== true || !Array.isArray(event.result?.rows)) throw Error("Invalid worker completion.");
      completion.result = event.result;
    }
  };
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.length; if (bytes > 40 * 1024 * 1024) throw Error("Worker response exceeds the report limit.");
      pending += decoder.decode(part.value, { stream: true });
      let index; while ((index = pending.indexOf("\n")) >= 0) { line(pending.slice(0, index)); pending = pending.slice(index + 1); }
    }
    pending += decoder.decode(); line(pending);
    const result=completion.result;
    if (!result) throw Error("The checking worker stopped before completion.");
    if(result.calculationVersion!==DUTY_CALCULATION_VERSION)throw Error("The checking worker needs the current calculation update. Previous results remain in check history.");
    return result;
  } finally { await reader.cancel().catch(() => {}); }
}
