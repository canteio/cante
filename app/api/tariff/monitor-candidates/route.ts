import { createRequestClient, getAuthenticatedWorkspace } from "@/lib/supabase/server";
import { getImpactRun } from "@/lib/tariff/business-impact-store";
import type { ImpactRow } from "@/lib/tariff/business-impact";
import {
  buildMonitoredCompanyImpacts,
  reviewedHistoricalCandidates,
  MONITOR_IMPACT_MAX_CANDIDATES,
  MonitorImpactLimitError,
  type MonitorCompanyCandidate,
} from "@/lib/tariff/monitor-company-impact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;
const MAX_MONITOR_RESPONSE_BYTES = 2 * 1024 * 1024;
const stringValue = (row: Row, key: string): string | null => typeof row[key] === "string" ? row[key] : null;

function boundedJson(value: unknown): Response {
  const body = JSON.stringify(value);
  if (new TextEncoder().encode(body).byteLength > MAX_MONITOR_RESPONSE_BYTES) {
    return Response.json({
      error: "Company tariff impact response exceeds the safe response limit.",
      code: "monitor_response_limit",
      limitBytes: MAX_MONITOR_RESPONSE_BYTES,
    }, { status: 422 });
  }
  return new Response(body, { headers: { "content-type": "application/json" } });
}

export async function GET(request: Request) {
  try {
    const workspace = await getAuthenticatedWorkspace();
    if (!workspace) return Response.json({ error: "Authentication required." }, { status: 401 });

    const runId = new URL(request.url).searchParams.get("runId")?.trim();
    if (!runId) return Response.json({ error: "A selected impact run is required." }, { status: 400 });
    const run = await getImpactRun(workspace.customerId, runId);
    if (!run) return Response.json({ error: "Run not found." }, { status: 404 });

    const linkedProductIds = [...new Set((run.rows as ImpactRow[])
      .map((row: ImpactRow) => row.product_id)
      .filter((id: string | null | undefined): id is string => typeof id === "string" && id.length > 0))];
    if (linkedProductIds.length === 0) return Response.json({ impacts: [] });

    const client = await createRequestClient();
    const { data: candidateData, error: candidateError } = await client.from("tariff_monitor_candidates")
      .select("id,finding_id,product_id,match_kind,match_reason,created_at")
      .eq("customer_id", workspace.customerId)
      .in("product_id", linkedProductIds)
      .order("created_at", { ascending: false }).order("id")
      .range(0, MONITOR_IMPACT_MAX_CANDIDATES);
    if (candidateError) throw candidateError;
    const candidateRows = (candidateData ?? []) as Row[];
    if (candidateRows.length > MONITOR_IMPACT_MAX_CANDIDATES) {
      return Response.json({
        error: "Too many monitored candidates to calculate safely.",
        code: "candidate_limit",
        limit: MONITOR_IMPACT_MAX_CANDIDATES,
      }, { status: 422 });
    }
    const reviewedCandidates = (run.rows as ImpactRow[]).some(row => row.analysis_kind === "historical_entries") ? reviewedHistoricalCandidates(run.rows) : [];
    if (candidateRows.length === 0) return boundedJson({ impacts: await buildMonitoredCompanyImpacts(reviewedCandidates, run.rows, undefined, { signal: request.signal }) });

    const findingIds = [...new Set(candidateRows.map(row => stringValue(row, "finding_id")).filter((id): id is string => Boolean(id)))];
    const productIds = [...new Set(candidateRows.map(row => stringValue(row, "product_id")).filter((id): id is string => Boolean(id)))];
    const [findingResult, productResult] = await Promise.all([
      client.from("findings").select("id,title,url,regulation_ref")
        .eq("customer_id", workspace.customerId).in("id", findingIds),
      client.from("products").select("id,sku,name")
        .eq("customer_id", workspace.customerId).in("id", productIds),
    ]);
    if (findingResult.error || productResult.error) throw new Error("Related monitor data unavailable.");

    const findings = new Map((findingResult.data ?? []).map((row: Row) => [stringValue(row, "id"), row]));
    const products = new Map((productResult.data ?? []).map((row: Row) => [stringValue(row, "id"), row]));
    const candidates: MonitorCompanyCandidate[] = candidateRows.flatMap(row => {
      const id = stringValue(row, "id");
      const findingId = stringValue(row, "finding_id");
      const productId = stringValue(row, "product_id");
      const matchKind = stringValue(row, "match_kind");
      if (!id || !findingId || !productId || (matchKind !== "exact_code" && matchKind !== "code_prefix")) return [];
      const finding = findings.get(findingId);
      const product = products.get(productId);
      const citations = finding
        ? [...new Set([stringValue(finding, "regulation_ref"), stringValue(finding, "url")]
            .filter((value): value is string => Boolean(value)))]
        : [];
      return [{
        id,
        findingId,
        productId,
        matchKind,
        matchReason: stringValue(row, "match_reason") ?? "Catalogue code overlap.",
        createdAt: stringValue(row, "created_at") ?? "",
        product: product ? {
          sku: stringValue(product, "sku") ?? productId,
          name: stringValue(product, "name") ?? productId,
        } : null,
        action: {
          name: finding ? stringValue(finding, "title") ?? "Monitored trade action" : "Monitored trade action",
          citations,
        },
      }];
    });

    const impacts = await buildMonitoredCompanyImpacts([...candidates, ...reviewedCandidates], run.rows, undefined, { signal: request.signal });
    return boundedJson({ impacts });
  } catch (error) {
    if (error instanceof MonitorImpactLimitError) {
      return Response.json({
        error: "Monitored company impact coverage exceeds the safe calculation limit.",
        code: error.code,
        limit: error.limit,
      }, { status: 422 });
    }
    if (request.signal.aborted) {
      return Response.json({ error: "Company tariff impact request was cancelled.", code: "request_aborted" }, { status: 499 });
    }
    return Response.json({ error: "Unable to load company tariff impact." }, { status: 500 });
  }
}
