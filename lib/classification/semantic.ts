import type { SupabaseClient } from "@supabase/supabase-js";
import type { CandidateHeading } from "./suggest";
import { embedTexts, type EmbeddingUsage } from "./embed";

export async function currentHtsRevision(signal?: AbortSignal): Promise<string> {
  const timeout = AbortSignal.timeout(30_000);
  const res = await fetch("https://hts.usitc.gov/reststop/currentRelease", {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTS currentRelease HTTP ${res.status}`);
  const raw = await res.json();
  const revision = typeof raw === "string" ? raw : raw?.name;
  if (typeof revision !== "string" || !revision.trim()) throw new Error("Missing HTS revision name");
  return revision.trim();
}

export async function searchSemanticHeadings(
  client: SupabaseClient,
  product: { name: string; description: string | null; materials: string[] },
  options: { signal?: AbortSignal; usage?: EmbeddingUsage } = {},
): Promise<CandidateHeading[]> {
  // Fail explicitly when the current revision is unavailable, never silently use stale codes.
  const revision = await currentHtsRevision(options.signal);
  const [vector] = await embedTexts([
    [product.name, product.description, product.materials.join(", ")].filter(Boolean).join("\n"),
  ], options);
  const query = client.rpc("match_hts_schedule", {
    query_embedding: JSON.stringify(vector), target_revision: revision, match_count: 30,
  });
  if (options.signal) query.abortSignal(options.signal);
  const { data, error } = await query;
  if (error) throw new Error(`HTS semantic retrieval failed: ${error.message}`);
  if (!data?.length) throw new Error(`No semantic HTS rows for current revision ${revision}; ingest the schedule first`);
  return data.map((row: { hts_code: string; full_description: string; general: string; units: string[] }) => ({
    code: row.hts_code, description: row.full_description, generalRate: row.general || "not published", units: row.units,
  }));
}

export function unionCandidates(keyword: CandidateHeading[], semantic: CandidateHeading[]): CandidateHeading[] {
  // Semantic rows carry the complete ancestry; preserve it on duplicate codes.
  return [...new Map([...keyword, ...semantic].map((row) => [row.code, row])).values()];
}
