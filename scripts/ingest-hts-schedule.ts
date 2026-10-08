import "./load-env";
import { setTimeout as delay } from "node:timers/promises";
import { createServiceClient } from "../lib/supabase/service";
import { flattenHtsChapter } from "../lib/classification/hts-schedule";
import { currentHtsRevision } from "../lib/classification/semantic";
import { embedTexts, embeddingBatches, embeddingUsage, EMBEDDING_USD_PER_MILLION_TOKENS } from "../lib/classification/embed";

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || !/^--chapters=\d{2}(,\d{2})*$/.test(args[0]))) {
    throw new Error("Usage: node --import tsx scripts/ingest-hts-schedule.ts [--chapters=39,85]");
  }
  const chapters = args.length ? [...new Set(args[0].split("=")[1].split(","))]
    : Array.from({ length: 99 }, (_, i) => String(i + 1).padStart(2, "0"));
  if (chapters.some((c) => !/^(0[1-9]|[1-9][0-9])$/.test(c))) throw new Error("Invalid chapter");
  const usage = embeddingUsage();
  const summary = { revision: "", chaptersRequested: chapters.length, chaptersFetched: 0, fetchFailed: [] as string[], publicationFailed: [] as string[], chaptersPublished: 0, totalLeafRows: 0, unchanged: 0, newlyEmbedded: 0, rowsPublished: 0 };
  try {
    summary.revision = await currentHtsRevision();
    const client = createServiceClient();
    for (const chapter of chapters) {
      let leaves;
      try {
        // USITC's exportList "to" boundary is exclusive of the next chapter's
        // start, not inclusive of this chapter — from=39&to=39 returns zero
        // rows; from=39&to=40 returns chapter 39's full content (confirmed
        // live). Chapter 99 has no "next" chapter to bound it; USITC accepts
        // to=99 itself as a terminal case for the last chapter.
        const toChapter = chapter === "99" ? "99" : String(Number(chapter) + 1).padStart(2, "0");
        const params = new URLSearchParams({ from: chapter, to: toChapter, format: "JSON", styles: "false" });
        const response = await fetch(`https://hts.usitc.gov/reststop/exportList?${params}`, { signal: AbortSignal.timeout(60_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        leaves = flattenHtsChapter(await response.json(), chapter);
        summary.chaptersFetched++;
        summary.totalLeafRows += leaves.length;
      } catch (error) {
        summary.fetchFailed.push(chapter);
        console.error(`Chapter ${chapter} fetch/parse failed:`, error instanceof Error ? error.message : error);
        await delay(1000);
        continue;
      }
      try {
        const existing = new Map<string, { description_hash: string; embedding: string }>();
        // Supabase defaults to 1000 rows per response; page even large chapters.
        for (let offset = 0; ; offset += 500) {
          const { data, error } = await client.from("hts_schedule_embeddings")
            .select("hts_code,description_hash,embedding").eq("chapter", chapter)
            .order("hts_code").range(offset, offset + 499);
          if (error) throw new Error(error.message);
          for (const row of data ?? []) existing.set(row.hts_code, row);
          if (!data || data.length < 500) break;
        }
        const changed = leaves.filter((row) => existing.get(row.htsCode)?.description_hash !== row.descriptionHash || !existing.get(row.htsCode)?.embedding);
        summary.unchanged += leaves.length - changed.length;
        const vectors = new Map<string, number[]>();
        for (const batch of embeddingBatches(changed, (row) => row.fullDescription)) {
          const embeddings = await embedTexts(batch.map((row) => row.fullDescription), { usage });
          batch.forEach((row, i) => vectors.set(row.htsCode, embeddings[i]));
          summary.newlyEmbedded += batch.length;
        }
        // Do not label data fetched across a release boundary as one revision.
        if (await currentHtsRevision() !== summary.revision) throw new Error("HTS release changed during ingestion; rerun");
        const rows = leaves.map((row) => ({
          hts_code: row.htsCode, chapter, full_description: row.fullDescription,
          description_hash: row.descriptionHash, general: row.general, special: row.special,
          other: row.other, additional_duties: row.additionalDuties, units: row.units,
          embedding: vectors.has(row.htsCode) ? JSON.stringify(vectors.get(row.htsCode)) : existing.get(row.htsCode)!.embedding,
        }));
        const { error } = await client.rpc("publish_hts_chapter", {
          target_chapter: chapter, target_revision: summary.revision, leaf_rows: rows,
        });
        if (error) throw new Error(error.message);
        summary.chaptersPublished++;
        summary.rowsPublished += rows.length;
        console.log(`Chapter ${chapter}: published ${rows.length} leaves, embedded ${changed.length}`);
      } catch (error) {
        summary.publicationFailed.push(chapter);
        console.error(`Chapter ${chapter} not published:`, error instanceof Error ? error.message : error);
      }
      await delay(1000);
    }
    if (summary.fetchFailed.length || summary.publicationFailed.length) process.exitCode = 1;
  } finally {
    console.log(JSON.stringify({ ...summary, chaptersNotAttempted: chapters.length - summary.chaptersFetched - summary.fetchFailed.length, embeddingApiCalls: usage.calls, inputTokens: usage.tokens,
      costUsdFromReportedUsage: usage.tokens * EMBEDDING_USD_PER_MILLION_TOKENS / 1_000_000,
      callsWithUnknownUsage: usage.unknownUsageCalls,
      costNote: "Standard $0.02/1M input tokens; usage-based calculation, not an invoice. Unknown-usage calls may incur additional cost.",
    }, null, 2));
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
