import { withRequestLimit } from "@/app/api/request-limits";
import { retryStackingAuthoringJob } from "@/lib/tariff/stacking-authoring";
import { z } from "zod";
import { createRequestClient, getAuthenticatedWorkspace, isPlatformTariffReviewer } from "@/lib/supabase/server";
import { stackingConditions } from "@/lib/tariff/stacking-authoring-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;
const review = z.object({
  id: z.string().uuid(), decision: z.enum(["confirm", "reject", "retry"]),
  conditions: stackingConditions.optional(),
  precedenceId: z.string().uuid().nullable().optional(),
  precedenceReason: z.string().max(2000).nullable().optional(),
  note: z.string().max(3000).optional(), sourceRead: z.boolean().optional(),
}).strict();

export async function GET(request: Request) {
  const workspace = await getAuthenticatedWorkspace();
  if (!workspace) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (!await isPlatformTariffReviewer()) return Response.json({ error: "Platform tariff reviewer access required." }, { status: 403 });
  try {
    const offset = z.coerce.number().int().min(0).max(1000000).safeParse(new URL(request.url).searchParams.get("offset") ?? 0);
    if (!offset.success) return Response.json({ error: "Invalid review offset." }, { status: 400 });
    const { data, error } = await (await createRequestClient()).rpc("read_tariff_stacking_reviews", { review_offset: offset.data });
    if (error?.code === "42501") return Response.json({ error: "Platform tariff reviewer access required." }, { status: 403 });
    if (error) throw error;
    return Response.json(data);
  } catch {
    return Response.json({ error: "Could not load stacking-rule reviews." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  return withRequestLimit(request, "chat", 20000, handlePOST);
}
async function handlePOST(request: Request) {
  const workspace = await getAuthenticatedWorkspace();
  if (!workspace) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (!await isPlatformTariffReviewer()) return Response.json({ error: "Platform tariff reviewer access required." }, { status: 403 });
  const parsed = review.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid review. Supply a draft ID, decision, and supported conditions." }, { status: 400 });
  const body = parsed.data;
  if (body.decision === "confirm" && (!body.sourceRead || (body.note?.trim().length ?? 0) < 10)) {
    return Response.json({ error: "Read the official source and record your legal basis before confirming." }, { status: 400 });
  }
  try {
    if (body.decision === "retry") {
      if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ error: "Authoring requires the trusted worker. Review existing drafts here; run authoring from the configured worker." }, { status: 503 });
      await retryStackingAuthoringJob(body.id, workspace.userId);
      return Response.json({ ok: true });
    }
    const { data, error } = await (await createRequestClient()).rpc("review_tariff_stacking_draft_authenticated", {
      draft_id: body.id, decision: body.decision, source_read: body.sourceRead ?? false,
      narrowed_conditions: body.conditions ?? null, precedence_id: body.precedenceId ?? null,
      precedence_basis: body.precedenceReason ?? null, reviewer_note: body.note?.trim() ?? null,
    });
    if (error?.code === "42501") return Response.json({ error: "Platform tariff reviewer access required." }, { status: 403 });
    if (error) return Response.json({ error: error.code === "P0001" ? error.message : "Rule review could not be saved." }, { status: error.code === "P0001" ? 409 : 503 });
    return Response.json({ ok: true, ruleId: data });
  } catch {
    return Response.json({ error: "Rule review could not be saved." }, { status: 503 });
  }
}
