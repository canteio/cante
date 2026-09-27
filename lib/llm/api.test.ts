import assert from "node:assert/strict";
import test from "node:test";
import { ApiProvider } from "./api";

// Extraction opts out of research. Verify the actual hosted request, including
// Anthropic's pause response, which must not trigger a second completion.
for (const hosted of ["openai", "anthropic"] as const) {
  test(`${hosted} extraction sends no tools and makes only one request`, async () => {
    const previous = process.env.CANTE_HOSTED_PROVIDER;
    const originalFetch = globalThis.fetch;
    let calls = 0;
    process.env.CANTE_HOSTED_PROVIDER = hosted;
    globalThis.fetch = async (_input, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.tools, []);
      return Response.json(hosted === "openai"
        ? { output_text: '{"legalName":"Acme"}' }
        : { stop_reason: "pause_turn", content: [] });
    };
    try {
      const result = new ApiProvider().complete({ system: "Extract", prompt: "Acme", tools: [], timeoutMs: 100 });
      if (hosted === "anthropic") await assert.rejects(result, /did not complete/);
      else assert.equal((await result).text, '{"legalName":"Acme"}');
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = originalFetch;
      if (previous === undefined) delete process.env.CANTE_HOSTED_PROVIDER;
      else process.env.CANTE_HOSTED_PROVIDER = previous;
    }
  });
}
