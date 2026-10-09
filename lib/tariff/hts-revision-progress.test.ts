import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { z } from "zod";
import { webcrypto } from "node:crypto";

function harness(completed: number) {
  let handler!: (req: Request) => Promise<Response>;
  const fetched: string[] = [];
  const published: string[] = [];
  const client = {
    from(table: string) {
      return { select() { return table === "hts_chapter_publications"
        ? Promise.resolve({ data: Array.from({ length: completed }, (_, i) => ({ chapter: String(i + 1).padStart(2, "0"), revision: "fixture" })), error: null })
        : { eq() { return { order() { return { range: async () => ({ data: [], error: null }) }; } }; } }; } };
    },
    async rpc(_name: string, args: { target_chapter: string }) { published.push(args.target_chapter); return { error: null }; },
  };
  const source = readFileSync("supabase/functions/hts-revision-check/index.ts", "utf8").replace(/^import .*;\n/gm, "");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, {
    z, createClient: () => client, TextEncoder, Response, AbortSignal, URLSearchParams, crypto: webcrypto,
    console: { error() {} },
    Deno: { serve(fn: typeof handler) { handler = fn; }, env: { get() { return "fixture-secret"; } } },
    fetch: async (url: string) => {
      if (url.includes("currentRelease")) return Response.json({ name: "fixture" });
      if (url.includes("api.openai.com")) return Response.json({ data: [{ index: 0, embedding: Array(384).fill(0) }] });
      const chapter = new URL(url).searchParams.get("from")!; fetched.push(chapter);
      // Reserved 99 succeeds; failure of any ordinary chapter must remain actionable.
      if (chapter === "99") {
        assert.equal(new URL(url).searchParams.get("to"), "9999");
        return Response.json([{ htsno: "9901.00.50", description: "Fixture", indent: 0, general: "Free" }]);
      }
      return Response.json([], { status: 502 });
    },
  });
  return { run: (secret = "fixture-secret") => handler(new Request("https://fixture.invalid", { headers: { authorization: `Bearer ${secret}` } })), fetched, published };
}

test("all chapter markers including reserved chapters are required for quiet success", async () => {
  const complete = harness(99);
  assert.equal((await complete.run()).status, 200);
  assert.deepEqual(complete.fetched, []);
  const partial = harness(97);
  const response = await partial.run();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).action, "incomplete");
  assert.deepEqual(partial.fetched, ["98", "99"]);
  assert.deepEqual(partial.published, ["99"]);
});
test("refresh authorization is checked before reading progress or fetching chapters", async () => {
  const h = harness(98);
  assert.equal((await h.run("wrong")).status, 401);
  assert.deepEqual(h.fetched, []);
});
