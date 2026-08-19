import assert from "node:assert/strict";
import test from "node:test";
import { JUDGMENT_BATCH_SIZE, judgeAllEntries, planBatches } from "@/lib/checks/judge-batched";
import type { RegulationEntry } from "@/lib/sources/fetch";
import type { LlmProvider } from "@/lib/llm/types";
import type { Customer, CustomerProfile } from "@/lib/db/schema";

/**
 * The defect these cover: 62 entries went into one judge() call and 20 verdicts
 * came back, three runs running. Batch size is the fix; everything here pins
 * the behaviour that makes it safe.
 */

function entry(n: number): RegulationEntry {
  return {
    sourceId: "src",
    sourceName: "Source",
    domain: "example.go.id",
    regulationType: "national",
    label: `Reg ${n}`,
    number: String(n),
    year: 2026,
    listingTitle: `Reg ${n}`,
    truncated: false,
    fullTitle: `Reg ${n}`,
    url: `https://example.go.id/${n}`,
    foundInViews: ["v"],
  };
}

/** A provider that answers every entry it is shown, and records batch sizes. */
function fakeProvider(options: {
  seen: number[];
  answerFraction?: number;
  failOnCall?: number;
}): LlmProvider {
  let call = 0;
  return {
    name: "fake",
    async available() {
      return { ok: true, detail: "" };
    },
    async complete(request: { prompt: string }) {
      call += 1;
      if (options.failOnCall === call) throw new Error("batch blew up");

      const urls = [...request.prompt.matchAll(/https:\/\/example\.go\.id\/\d+/g)].map((m) => m[0]);
      // The message-composing call carries no entry URLs.
      if (urls.length === 0) {
        return {
          text: JSON.stringify({
            whatsappMessage: "*Aman* — tidak ada yang baru.",
            summaryId: "ringkasan",
            summaryEn: "summary",
          }),
        };
      }
      options.seen.push(urls.length);
      const answered = urls.slice(0, Math.ceil(urls.length * (options.answerFraction ?? 1)));
      return {
        text: JSON.stringify({
          summaryId: "x",
          summaryEn: "x",
          coverageCaveats: [],
          whatsappMessage: "ignored",
          findings: answered.map((url) => ({
            sourceId: "src",
            regulationRef: url,
            title: url,
            url,
            enactedOn: null,
            relevance: "clear",
            reasoning: "not relevant",
            summaryId: null,
            summaryEn: null,
          })),
        }),
      };
    },
  } as unknown as LlmProvider;
}

function input(entries: RegulationEntry[]) {
  return {
    customer: { name: "MA" } as Customer,
    profile: {
      productDescription: "PVC tarpaulin",
      destinationMarkets: [],
      destinationsConfirmed: false,
      relevanceGuidance: { likelyRelevant: [], almostNeverRelevant: [] },
      sideOfTrade: "domestic",
      hsCodes: [],
      hsCodesConfirmed: false,
      kbliCodes: [],
    } as unknown as CustomerProfile,
    jurisdiction: "Indonesia" as const,
    jurisdictionProfile: null,
    report: {
      runAt: "2026-08-19T00:00:00.000Z",
      outcomes: [],
      regulations: entries,
      heartbeats: [],
      coverageCaveats: [],
    },
    seen: [],
    lastRunAt: null,
    memories: [],
  };
}

test("entries are split into batches of a size a model actually completes", () => {
  const batches = planBatches(Array.from({ length: 62 }, (_, i) => i));
  assert.equal(batches.length, Math.ceil(62 / JUDGMENT_BATCH_SIZE));
  assert.ok(
    batches.every((b) => b.length <= JUDGMENT_BATCH_SIZE),
    "no batch may exceed the size that was observed to work",
  );
  assert.equal(batches.flat().length, 62, "batching must not lose an entry");
});

test("planBatches keeps order and handles the empty case", () => {
  assert.deepEqual(planBatches([], 5), []);
  assert.deepEqual(planBatches([1, 2, 3], 2), [[1, 2], [3]]);
});

test("62 entries are judged in batches, and every one gets a verdict", async () => {
  // The exact shape of run 4a28d566, which returned 20 of 62.
  const entries = Array.from({ length: 62 }, (_, i) => entry(i));
  const seen: number[] = [];
  const result = await judgeAllEntries(fakeProvider({ seen }), input(entries));

  assert.equal(result.findings.length, 62, "every entry must come back with a verdict");
  assert.equal(result.batches, Math.ceil(62 / JUDGMENT_BATCH_SIZE));
  assert.ok(
    seen.every((size) => size <= JUDGMENT_BATCH_SIZE),
    "the model must never be shown more entries at once than it can complete",
  );
});

test("a verdict for an entry outside its batch is discarded", async () => {
  // A stray row would otherwise mask a genuinely unjudged entry in the audit.
  const entries = [entry(1), entry(2)];
  const provider = {
    name: "fake",
    async available() {
      return { ok: true, detail: "" };
    },
    async complete(request: { prompt: string }) {
      if (!request.prompt.includes("example.go.id")) {
        return {
          text: JSON.stringify({ whatsappMessage: "m", summaryId: "s", summaryEn: "s" }),
        };
      }
      return {
        text: JSON.stringify({
          summaryId: "x",
          summaryEn: "x",
          coverageCaveats: [],
          whatsappMessage: "ignored",
          findings: [
            {
              sourceId: "src",
              regulationRef: "outsider",
              title: "outsider",
              url: "https://example.go.id/999",
              enactedOn: null,
              relevance: "clear",
              reasoning: "not in this batch",
              summaryId: null,
              summaryEn: null,
            },
          ],
        }),
      };
    },
  } as unknown as LlmProvider;

  const result = await judgeAllEntries(provider, input(entries), { batchSize: 2 });
  assert.equal(result.findings.length, 0, "only verdicts for entries in the batch count");
});

test("one failing batch is disclosed and does not abort the rest", async () => {
  const entries = Array.from({ length: 6 }, (_, i) => entry(i));
  const seen: number[] = [];
  const result = await judgeAllEntries(
    fakeProvider({ seen, failOnCall: 1 }),
    input(entries),
    { batchSize: 2 },
  );

  assert.equal(result.failedBatches, 1);
  assert.equal(result.findings.length, 4, "the surviving batches still produce verdicts");
  assert.ok(
    result.coverageCaveats.some((c) => c.includes("kelompok penilaian gagal")),
    "a lost batch must be disclosed, never silently missing",
  );
});

test("the customer message is composed once, from the findings", async () => {
  const entries = Array.from({ length: 4 }, (_, i) => entry(i));
  const result = await judgeAllEntries(fakeProvider({ seen: [] }), input(entries), {
    batchSize: 2,
  });
  // Each batch writes its own message about its own slice; only the dedicated
  // composing call sees the whole picture, so that is the one that is used.
  assert.equal(result.whatsappMessage, "*Aman* — tidak ada yang baru.");
  assert.notEqual(result.whatsappMessage, "ignored");
});
