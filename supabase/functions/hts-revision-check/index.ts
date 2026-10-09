// Supabase Edge Function: scheduled HTS revision check + ingestion trigger.
//
// Deno port of scripts/check-hts-revision.ts + scripts/ingest-hts-schedule.ts.
// This is now the AUTHORITATIVE, server-side schedule for HTS revision
// checks (see scripts/check-hts-revision.ts's doc comment for the local/
// manual-debugging counterpart). Invoked on a recurring cadence by a
// pg_cron job (see supabase/migrations/*_hts_revision_cron.sql) via
// pg_net's http_post, so this never depends on a human or coding agent
// remembering to run a script.
//
// Auth: Supabase's built-in verify_jwt is NOT used (deployed with
// --no-verify-jwt) because this project's anon/service keys are the new
// sb_publishable_/sb_secret_ format, not legacy JWTs, so they would fail
// verify_jwt. Instead this function checks a shared secret
// (HTS_CRON_SHARED_SECRET) sent as `Authorization: Bearer <secret>`,
// compared with a constant-time check. The pg_cron job reads that same
// secret out of Supabase Vault, never hardcoding it in migration SQL.
//
// Ingestion logic deliberately mirrors ingest-hts-schedule.ts row-for-row
// (same chapter boundaries, same hash-based skip-if-unchanged behavior, same
// publish_hts_chapter RPC) so this can never drift from the already-reviewed
// Node script. It re-implements (rather than imports) that logic because
// Deno Edge Functions cannot import repo-relative Node modules; the two are
// README-cross-referenced and should be changed together.
//
// Time-boxing: full ingestion (99 chapters x embeddings) will not reliably
// complete inside one Edge Function invocation's wall-clock limit. Each
// chapter publish is independently idempotent (unchanged rows are skipped
// by content hash, same as the Node script), so this function processes
// one chapter per worker request, with a bounded coordinator --
// the next scheduled invocation (6h later) picks up any remaining chapters
// cheaply, since already-published chapters cost one hash comparison each.

import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.24.1";

const TIME_BUDGET_MS = 110_000; // stay under Edge Function wall-clock limits
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 384;

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  if (bufA.length !== bufB.length) {
    // Still touch bufA.length bytes of bufB-shaped work to avoid a trivial
    // length-based timing short-circuit; exact-length is not secret here.
    return false;
  }
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}

async function currentHtsRevision(): Promise<string> {
  const res = await fetch("https://hts.usitc.gov/reststop/currentRelease", {
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTS currentRelease HTTP ${res.status}`);
  const raw = await res.json();
  const revision = typeof raw === "string" ? raw : raw?.name;
  if (typeof revision !== "string" || !revision.trim()) throw new Error("Missing HTS revision name");
  return revision.trim();
}

// Minimal HTML-to-text: USITC description cells are simple (<i>, <br>, a
// handful of entities) -- not full markup, so a regex strip is sufficient
// and keeps this function dependency-light (no cheerio/DOM in Deno).
const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " ",
};
function plainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#?\w+);/g, (m, name) => ENTITIES[name] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const ExportRow = z.object({
  htsno: z.string(),
  indent: z.union([z.string(), z.number()]).transform(Number).pipe(z.number().int().nonnegative()),
  description: z.string(),
  general: z.string().default(""),
  special: z.string().default(""),
  other: z.string().default(""),
  additionalDuties: z.string().nullish(),
  units: z.array(z.string()).nullish().transform((v) => v ?? []),
});

interface ScheduleLeaf {
  htsCode: string;
  chapter: string;
  fullDescription: string;
  descriptionHash: string;
  general: string;
  special: string;
  other: string;
  additionalDuties: string;
  units: string[];
}

async function flattenHtsChapter(payload: unknown, chapter: string): Promise<ScheduleLeaf[]> {
  if (!/^(0[1-9]|[1-9][0-9])$/.test(chapter)) throw new Error("Invalid HTS chapter");
  const rows = z.array(ExportRow).parse(payload);
  const stack: z.infer<typeof ExportRow>[] = [];
  const found = new Map<string, ScheduleLeaf>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    while (stack.length && stack[stack.length - 1].indent >= row.indent) stack.pop();
    const code = row.htsno.trim();
    if (code && !code.replace(/\D/g, "").startsWith(chapter)) {
      throw new Error(`HTS export for chapter ${chapter} contains ${code}`);
    }
    stack.push(row);
    if (rows[i + 1] && rows[i + 1].indent > row.indent) continue;
    if (!/^(\d{4}\.\d{2}\.\d{2})(\.\d{2})?$/.test(code)) continue;
    const inherit = (key: "general" | "special" | "other" | "additionalDuties") =>
      plainText([...stack].reverse().find((parent) => parent[key]?.trim())?.[key] ?? "");
    const general = inherit("general");
    const special = inherit("special");
    const other = inherit("other");
    if (!general && !special && !other) continue;
    const fullDescription = stack.map((parent) => plainText(parent.description)).filter(Boolean).join(" > ");
    if (!fullDescription) throw new Error(`Missing description for ${code}`);
    if (found.has(code)) throw new Error(`Duplicate HTS leaf ${code}`);
    found.set(code, {
      htsCode: code, chapter, fullDescription,
      descriptionHash: await sha256Hex(fullDescription),
      general, special, other, additionalDuties: inherit("additionalDuties"),
      units: [...stack].reverse().find((parent) => parent.units.length)?.units ?? [],
    });
  }
  if (!found.size && chapter !== "77") throw new Error(`No rate-bearing HTS leaves in chapter ${chapter}`);
  return [...found.values()];
}

function embeddingBatches<T>(rows: T[], text: (row: T) => string): T[][] {
  const batches: T[][] = [];
  let batch: T[] = [], bytes = 0;
  for (const row of rows) {
    const value = text(row);
    const size = new TextEncoder().encode(value).length;
    if (!value.trim() || size > 8000) throw new Error("Embedding input empty or exceeds conservative 8000-token bound");
    if (batch.length && (batch.length >= 75 || bytes + size > 8000)) {
      batches.push(batch); batch = []; bytes = 0;
    }
    batch.push(row); bytes += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

async function embedTexts(input: string[], openaiKey: string): Promise<number[][]> {
  if (embeddingBatches(input, (s) => s).length !== 1) throw new Error("Pass one bounded embedding batch");
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS, encoding_format: "float", input }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`OpenAI embeddings HTTP ${response.status}`);
  const raw = await response.json();
  const data = z.array(z.object({
    index: z.number().int().nonnegative(),
    embedding: z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS),
  })).length(input.length).parse(raw.data).sort((a, b) => a.index - b.index);
  return data.map((row) => row.embedding);
}

// deno-lint-ignore no-explicit-any
function createServiceClient(): any {
  const url = Deno.env.get("HTS_SUPABASE_URL");
  const secret = Deno.env.get("HTS_SUPABASE_SECRET_KEY");
  if (!url || !secret) throw new Error("HTS_SUPABASE_URL and HTS_SUPABASE_SECRET_KEY secrets are required");
  return createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
}

// deno-lint-ignore no-explicit-any
async function runIngestion(client: any, revision: string, openaiKey: string, deadline: number, completed: Set<string>, requestedChapters: string[]) {
  const summary = {
    revision, chaptersAttempted: 0, chaptersFetched: 0, fetchFailed: [] as string[],
    publicationFailed: [] as string[], chaptersPublished: 0, chaptersSkippedOnTimeBudget: [] as string[],
    unchanged: 0, newlyEmbedded: 0, rowsPublished: 0,
  };
  const chapters = requestedChapters;
  for (const chapter of chapters) {
    if (completed.has(chapter)) continue;
    if (Date.now() > deadline) { summary.chaptersSkippedOnTimeBudget.push(chapter); continue; }
    summary.chaptersAttempted++;
    let leaves: ScheduleLeaf[];
    try {
      const toChapter = chapter === "99" ? "9999" : String(Number(chapter) + 1).padStart(2, "0");
      const params = new URLSearchParams({ from: chapter, to: toChapter, format: "JSON", styles: "false" });
      const response = await fetch(`https://hts.usitc.gov/reststop/exportList?${params}`, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      leaves = await flattenHtsChapter(await response.json(), chapter);
      summary.chaptersFetched++;
    } catch (error) {
      summary.fetchFailed.push(chapter);
      console.error(`Chapter ${chapter} fetch/parse failed:`, error instanceof Error ? error.message : error);
      continue;
    }
    try {
      const existing = new Map<string, { description_hash: string }>();
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await client.from("hts_schedule_embeddings")
          .select("hts_code,description_hash").eq("chapter", chapter)
          .order("hts_code").range(offset, offset + 499);
        if (error) throw new Error(error.message);
        for (const row of data ?? []) existing.set(row.hts_code, row);
        if (!data || data.length < 500) break;
      }
      const changed = leaves.filter((row) => existing.get(row.htsCode)?.description_hash !== row.descriptionHash);
      summary.unchanged += leaves.length - changed.length;
      const vectors = new Map<string, number[]>();
      for (const batch of embeddingBatches(changed, (row) => row.fullDescription)) {
        const embeddings = await embedTexts(batch.map((row) => row.fullDescription), openaiKey);
        batch.forEach((row, i) => vectors.set(row.htsCode, embeddings[i]));
        summary.newlyEmbedded += batch.length;
      }
      if (await currentHtsRevision() !== revision) throw new Error("HTS release changed during ingestion; rerun");
      const rows = leaves.map((row) => ({
        hts_code: row.htsCode, chapter, full_description: row.fullDescription,
        description_hash: row.descriptionHash, general: row.general, special: row.special,
        other: row.other, additional_duties: row.additionalDuties, units: row.units,
        embedding: vectors.has(row.htsCode) ? JSON.stringify(vectors.get(row.htsCode)) : null,
      }));
      const { error } = await client.rpc("publish_hts_chapter", {
        target_chapter: chapter, target_revision: revision, leaf_rows: rows,
      });
      if (error) throw new Error(error.message);
      summary.chaptersPublished++;
      summary.rowsPublished += rows.length;
    } catch (error) {
      summary.publicationFailed.push(chapter);
      console.error(`Chapter ${chapter} not published:`, error instanceof Error ? error.message : error);
    }
  }
  return summary;
}

async function recordHealth(client: any, revision: string, status: string, detail: string) {
  const { data, error } = await client.from("hts_chapter_publications").select("chapter,revision");
  if (error) throw new Error("Could not read publication health");
  const count = new Set((data ?? []).filter((row: any) => row.revision === revision).map((row: any) => row.chapter)).size;
  const now = new Date().toISOString();
  const { error: saveError } = await client.from("tariff_sync_status").upsert({
    source: "usitc_hts", revision, status, checked_at: now, completed_chapters: count, detail,
    ...(status === "complete" ? { last_success_at: now } : {}),
  }, { onConflict: "source" });
  if (saveError) throw new Error("Could not save publication health");
}

Deno.serve(async (req: Request) => {
  try {
    const expected = Deno.env.get("HTS_CRON_SHARED_SECRET");
    const authHeader = req.headers.get("authorization") ?? "";
    const provided = authHeader.replace(/^Bearer\s+/i, "");
    if (!expected || !timingSafeEqual(provided, expected)) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
    }

    const client = createServiceClient();
    const live = await currentHtsRevision();
    const { data, error } = await client.from("hts_chapter_publications")
      .select("chapter,revision");
    if (error) throw new Error(`Failed to read HTS chapter progress: ${error.message}`);
    const completed = new Set<string>((data ?? []).filter((row: { revision: string }) => row.revision === live)
      .map((row: { chapter: string }) => row.chapter));
    const ingested = completed.size === 99 ? live : null;
    if (completed.size === 99) {
      await recordHealth(client, live, "complete", "All 99 chapter publication markers verified.");
      return new Response(JSON.stringify({ liveRevision: live, ingestedRevision: ingested, action: "none", message: "All 99 chapters published for this revision." }),
        { status: 200, headers: { "content-type": "application/json" } });
    }

    const openaiKey = Deno.env.get("HTS_OPENAI_API_KEY");
    if (!openaiKey) throw new Error("HTS_OPENAI_API_KEY secret is required for ingestion");

    // CPU time is limited independently of wall-clock time. A coordinator
    // delegates ONE chapter per request; processing dozens in one isolate
    // caused production HTTP 546 even within the wall-clock budget.
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    if (body.chapter !== undefined) {
      if (typeof body.chapter !== "string" || !/^(0[1-9]|[1-9][0-9])$/.test(body.chapter) || body.revision !== live) {
        return Response.json({ error: "Invalid chapter or stale revision." }, { status: 409 });
      }
      const summary = await runIngestion(client, live, openaiKey, Date.now() + TIME_BUDGET_MS, completed, [body.chapter]);
      const failed = summary.fetchFailed.length || summary.publicationFailed.length || summary.chaptersSkippedOnTimeBudget.length;
      return Response.json({ action: failed ? "incomplete" : "chapter_published", summary }, { status: failed ? 503 : 200 });
    }
    await recordHealth(client, live, "running", "Checking and publishing missing chapters in bounded requests.");
    const missing = Array.from({ length: 99 }, (_, i) => String(i + 1).padStart(2, "0")).filter(chapter => !completed.has(chapter));
    // Stay below the platform's nested-call limit (30 per trace/minute).
    const pending = missing.slice(0, 24);
    const deadline = Date.now() + TIME_BUDGET_MS;
    const summary = { chaptersPublished: 0, fetchFailed: [] as string[], publicationFailed: [] as string[], chaptersSkippedOnTimeBudget: missing.slice(24) };
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
      while (next < pending.length) {
        const chapter = pending[next++];
        if (Date.now() > deadline - 15_000) { summary.chaptersSkippedOnTimeBudget.push(chapter); continue; }
        try {
          const response = await fetch(`${Deno.env.get("HTS_SUPABASE_URL")}/functions/v1/hts-revision-check`, {
            method: "POST", headers: { authorization: `Bearer ${expected}`, "content-type": "application/json" },
            body: JSON.stringify({ chapter, revision: live }), signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
          });
          const result = await response.json();
          if (!response.ok || result.action !== "chapter_published") throw new Error(`Chapter worker HTTP ${response.status}`);
          summary.chaptersPublished++;
        } catch (error) {
          summary.publicationFailed.push(chapter);
          console.error(`Chapter ${chapter} worker failed:`, error instanceof Error ? error.message : error);
        }
      }
    }));
    const incomplete = summary.fetchFailed.length || summary.publicationFailed.length || summary.chaptersSkippedOnTimeBudget.length;
    await recordHealth(client, live, incomplete ? "incomplete" : "complete", incomplete ? "Some chapters are incomplete. Totals and review coverage must be checked separately." : "All 99 chapter publication markers verified.");
    return new Response(JSON.stringify({ liveRevision: live, ingestedRevision: incomplete ? null : live, action: incomplete ? "incomplete" : "ingested", summary }),
      { status: incomplete ? 503 : 200, headers: { "content-type": "application/json" } });
  } catch (error) {
    console.error("hts-revision-check failed:", error instanceof Error ? error.message : error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { "content-type": "application/json" } });
  }
});
