import { createHmac } from "node:crypto";
import { z } from "zod";

const requestSchema = z.object({
  email: z.string().trim().email().max(254),
  website: z.string().max(0).optional().default(""),
});

const rpcResponseSchema = z.union([
  z.object({ accepted: z.literal(true), rate_limited: z.literal(false) }).strict(),
  z.object({ accepted: z.literal(false), rate_limited: z.literal(true) }).strict(),
]);

export type WaitlistResult =
  | { ok: true }
  | { ok: false; status: 400 | 429 | 500 | 503; message: string };

export function parseWaitlistRequest(value: unknown) {
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) return null;
  return { email: parsed.data.email.toLowerCase() };
}

export function hashWaitlistIp(ip: string, salt: string) {
  return createHmac("sha256", salt).update(ip || "unknown").digest("hex");
}

export async function joinWaitlist(
  email: string,
  ipHash: string,
  userAgent: string,
  fetcher: typeof fetch = fetch,
): Promise<WaitlistResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.WAITLIST_WRITE_KEY;

  if (!url || !key) {
    return { ok: false, status: 503, message: "The waitlist is not available yet." };
  }

  try {
    const response = await fetcher(`${url}/rest/v1/rpc/join_waitlist`, {
      method: "POST",
      headers: {
        apikey: key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requested_email: email,
        requested_ip_hash: ipHash,
        requested_user_agent: userAgent.slice(0, 500),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });

    if (response.ok) {
      const parsed = rpcResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        console.error("Waitlist RPC returned an invalid response");
        return { ok: false, status: 500, message: "We couldn't save your email. Please try again." };
      }
      if (parsed.data.rate_limited) {
        return { ok: false, status: 429, message: "Too many attempts. Try again in a few minutes." };
      }
      return { ok: true };
    }

    if (response.status === 429) {
      return { ok: false, status: 429, message: "Too many attempts. Try again in a few minutes." };
    }

    console.error("Waitlist RPC failed", { status: response.status });
    return { ok: false, status: 500, message: "We couldn't save your email. Please try again." };
  } catch (error) {
    console.error("Waitlist request failed", error);
    return { ok: false, status: 500, message: "We couldn't save your email. Please try again." };
  }
}
