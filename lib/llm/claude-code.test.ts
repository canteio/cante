import assert from "node:assert/strict";
import test from "node:test";
import { describeTool, parseSearchResults } from "./claude-code";

/**
 * Unit coverage for the pure, subprocess-free logic in lib/llm/claude-code.ts.
 *
 * Everything else in that file spawns a real `claude` binary, which is out of
 * reach in CI/cron without a login. `describeTool` and `parseSearchResults`
 * are plain string/JSON parsing with real bugs possible (the hardcoded-
 * favicon regression documented right above `describeTool` is exactly the
 * kind of thing a test like this would have caught immediately), so they are
 * worth locking down even though the class around them isn't testable here.
 */

test("describeTool renders a WebSearch call by its query", () => {
  assert.deepEqual(describeTool("WebSearch", { query: "US HTS 6306.12.00 duty rate" }), {
    detail: "US HTS 6306.12.00 duty rate",
  });
});

test("describeTool falls back to a generic label when WebSearch has no query", () => {
  assert.deepEqual(describeTool("WebSearch", {}), { detail: "the web" });
});

test("describeTool renders a WebFetch call by hostname, keeping the full url", () => {
  const result = describeTool("WebFetch", { url: "https://hts.usitc.gov/reststop/exportList" });
  assert.equal(result.detail, "hts.usitc.gov");
  assert.equal(result.hostname, "hts.usitc.gov");
  assert.equal(result.url, "https://hts.usitc.gov/reststop/exportList");
});

test("describeTool degrades gracefully for an unparseable WebFetch url", () => {
  const result = describeTool("WebFetch", { url: "not-a-url" });
  assert.equal(result.detail, "not-a-url");
  assert.equal(result.hostname, undefined);
});

test("describeTool falls back to the raw tool name for anything else", () => {
  assert.deepEqual(describeTool("Read", { file_path: "/tmp/x" }), { detail: "Read" });
});

test("parseSearchResults extracts title/url/hostname and de-duplicates by url", () => {
  const content =
    'Some preamble text. Links: [{"title":"USITC HTS","url":"https://hts.usitc.gov/"},' +
    '{"title":"Duplicate","url":"https://hts.usitc.gov/"},' +
    '{"title":"CBP","url":"https://www.cbp.gov/trade"}] trailing text.';
  const results = parseSearchResults(content);
  assert.equal(results.length, 2);
  assert.deepEqual(results[0], { title: "USITC HTS", url: "https://hts.usitc.gov/", hostname: "hts.usitc.gov" });
  assert.equal(results[1].hostname, "www.cbp.gov");
});

test("parseSearchResults returns empty array when there is no Links block", () => {
  assert.deepEqual(parseSearchResults("just some plain tool output"), []);
});

test("parseSearchResults skips entries with an invalid or missing url", () => {
  const content = 'Links: [{"title":"No url"},{"title":"Bad","url":"::not a url::"}]';
  assert.deepEqual(parseSearchResults(content), []);
});

test("parseSearchResults reads content passed as an array of text blocks", () => {
  const content = [
    { type: "text", text: 'Links: [{"title":"Only","url":"https://example.gov/x"}]' },
  ];
  const results = parseSearchResults(content);
  assert.equal(results.length, 1);
  assert.equal(results[0].url, "https://example.gov/x");
});
