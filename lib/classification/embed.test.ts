import assert from "node:assert/strict";
import test from "node:test";
import { embedTexts, embeddingBatches, embeddingUsage } from "./embed";
import { unionCandidates, searchSemanticHeadings } from "./semantic";
import type { SupabaseClient } from "@supabase/supabase-js";

test("batching bounds bytes and rows, refusing oversized input rather than truncating", () => {
  const batches = embeddingBatches(Array(160).fill("x"), String);
  assert.deepEqual(batches.map((b) => b.length), [75, 75, 10]);
  assert.deepEqual(embeddingBatches(["x".repeat(5000), "y".repeat(4000)], String).map((b) => b.length), [1, 1]);
  assert.throws(() => embeddingBatches(["é".repeat(4001)], String));
  assert.throws(() => embeddingBatches([" "], String));
});

test("embedding transport uses 384 dimensions, orders indexes, accounts usage, rejects malformed vectors", async () => {
  const original = fetch, key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only";
  const usage = embeddingUsage();
  let malformed = false;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "text-embedding-3-small");
    assert.equal(body.dimensions, 384);
    assert.deepEqual(body.input, ["a", "b"]);
    return Response.json({ usage: { prompt_tokens: 2 }, data: [
      { index: 1, embedding: Array(malformed ? 383 : 384).fill(2) },
      { index: 0, embedding: Array(384).fill(1) },
    ] });
  };
  try {
    assert.deepEqual((await embedTexts(["a", "b"], { usage })).map((v) => v[0]), [1, 2]);
    malformed = true;
    await assert.rejects(embedTexts(["a", "b"], { usage }));
    assert.deepEqual(usage, { calls: 2, tokens: 4, unknownUsageCalls: 0 });
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key;
  }
});

test("union retains semantic-only candidates beyond keyword quota and full descriptions on duplicates", () => {
  const keyword = Array.from({ length: 30 }, (_, i) => ({ code: String(i), description: "short", generalRate: "Free", units: [] }));
  const semantic = [{ ...keyword[0], description: "Full > ancestry" }, { ...keyword[0], code: "3916.90.30" }];
  const rows = unionCandidates(keyword, semantic);
  assert.equal(rows.length, 31);
  assert.equal(rows[0].description, "Full > ancestry");
  assert.ok(rows.some((r) => r.code === "3916.90.30"));
});

test("semantic lookup filters revision and propagates database failures", async () => {
  const original = fetch, key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only";
  globalThis.fetch = async (url) => String(url).includes("currentRelease")
    ? Response.json({ name: "test-revision" })
    : Response.json({ usage: { prompt_tokens: 5 }, data: [{ index: 0, embedding: Array(384).fill(1) }] });
  const client = { rpc(name: string, args: Record<string, unknown>) {
    assert.equal(name, "match_hts_schedule");
    assert.equal(args.target_revision, "test-revision");
    assert.equal(args.match_count, 30);
    return Promise.resolve({ data: null, error: { message: "database unavailable" } });
  } } as unknown as SupabaseClient;
  try {
    await assert.rejects(searchSemanticHeadings(client, { name: "wire", description: "copper", materials: [] }), /database unavailable/);
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key;
  }
});
