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

function eventStream(events: unknown[], end = true) {
  const bytes = new TextEncoder().encode(events.map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join(""));
  return new Response(new ReadableStream({
    start(controller) {
      // Deliberately split UTF-8, JSON, CRLF and frame boundaries.
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      if (end) controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } });
}

async function withOpenAiStream(response: Response, check: (provider: ApiProvider, calls: () => number) => Promise<void>) {
  const previous = process.env.CANTE_HOSTED_PROVIDER;
  const originalFetch = globalThis.fetch;
  let count = 0;
  process.env.CANTE_HOSTED_PROVIDER = "openai";
  globalThis.fetch = async (_input, init) => {
    count++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.stream, true);
    assert.equal(body.store, false);
    assert.deepEqual(body.include, ["web_search_call.action.sources"]);
    return response;
  };
  try { await check(new ApiProvider(), () => count); }
  finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.CANTE_HOSTED_PROVIDER;
    else process.env.CANTE_HOSTED_PROVIDER = previous;
  }
}

test("OpenAI chat streams actual search sources, thinking state and incremental UTF-8 answer in one call", async () => {
  const item = { id: "search-1", type: "web_search_call", action: { type: "search", sources: [
    { url: "https://www.cbp.gov/trade", title: "CBP trade" },
    { url: "javascript:alert(1)" }, { url: "not-a-url" },
  ] } };
  await withOpenAiStream(eventStream([
    { type: "response.created" },
    { type: "response.output_item.added", item: { id: item.id, type: item.type } },
    { type: "response.web_search_call.in_progress", item_id: item.id },
    { type: "response.output_item.done", item },
    { type: "response.output_text.delta", delta: "I can’t " },
    { type: "response.output_text.delta", delta: "confirm a change." },
    { type: "response.completed", response: { output: [item] } },
  ]), async (provider, calls) => {
    const events = [];
    for await (const event of provider.stream({ system: "Brief expert", prompt: "Check updates", tools: ["WebSearch"] })) events.push(event);
    assert.equal(calls(), 1);
    assert.equal(events.filter(e => e.type === "tool_start").length, 1);
    const result = events.find(e => e.type === "tool_end");
    assert.deepEqual(result, { type: "tool_end", id: item.id, results: [{ url: "https://www.cbp.gov/trade", title: "CBP trade", hostname: "www.cbp.gov" }] });
    assert.equal(events.filter(e => e.type === "text").map(e => e.type === "text" ? e.text : "").join(""), "I can’t confirm a change.");
    assert.equal(events.at(-1)?.type, "done");
    assert.equal(events.filter(e => e.type === "thinking_start").length, 1);
    assert.equal(events.filter(e => e.type === "thinking_end").length, 1);
  });
});

for (const failure of ["response.incomplete", "response.failed", "truncated", "empty"]) {
  test(`OpenAI stream reports ${failure} honestly without retry or successful done`, async () => {
    const events = failure === "truncated" ? [{ type: "response.created" }]
      : failure === "empty" ? [{ type: "response.completed", response: { output: [] } }]
      : [{ type: failure, response: { error: { message: "Research failed" } } }];
    await withOpenAiStream(eventStream(events), async (provider, calls) => {
      const received = [];
      for await (const event of provider.stream({ system: "Brief expert", prompt: "Check updates" })) received.push(event);
      assert.equal(calls(), 1);
      assert.equal(received.at(-1)?.type, "error");
      assert.equal(received.some(e => e.type === "done"), false);
    });
  });
}

test("OpenAI yields before the upstream response finishes and releases its reader on cancellation", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: {"type":"response.created"}\n\n')); },
    cancel() { cancelled = true; },
  }));
  await withOpenAiStream(response, async (provider, calls) => {
    const iterator = provider.stream({ system: "Brief expert", prompt: "Check updates" })[Symbol.asyncIterator]();
    const first = await iterator.next();
    assert.equal(first.value?.type, "thinking_start");
    await iterator.return!(undefined);
    assert.equal(cancelled, true);
    assert.equal(calls(), 1);
  });
});

test("OpenAI streams provider summaries separately from private reasoning and answer text", async () => {
  const summary = { item_id: "reason-1", summary_index: 0 };
  await withOpenAiStream(eventStream([
    { type: "response.created" },
    { type: "response.reasoning_text.delta", delta: "private reasoning must not appear" },
    { type: "response.reasoning_summary_text.delta", ...summary, delta: "Checking " },
    { type: "response.reasoning_summary_text.delta", ...summary, delta: "the source." },
    { type: "response.reasoning_summary_text.done", ...summary, text: "Checking the source." },
    { type: "response.output_text.delta", delta: "Here is the answer." },
    { type: "response.completed" },
  ]), async (provider, calls) => {
    const events = [];
    for await (const event of provider.stream({ system: "Brief expert", prompt: "Check", reasoningSummary: true })) events.push(event);
    assert.equal(calls(), 1);
    assert.deepEqual(events.filter(e => e.type === "reasoning_summary"), [
      { type: "reasoning_summary", id: "summary-reason-1-0", text: "Checking ", done: false },
      { type: "reasoning_summary", id: "summary-reason-1-0", text: "the source.", done: false },
      { type: "reasoning_summary", id: "summary-reason-1-0", text: "Checking the source.", done: true },
    ]);
    assert.equal(JSON.stringify(events).includes("private reasoning"), false);
    assert.deepEqual(events.filter(e => e.type === "text"), [{ type: "text", text: "Here is the answer." }]);
  });
});

for (const [model, enabled, expected] of [["gpt-5-mini", true, true], ["gpt-5-mini", false, false], ["gpt-4o", true, false]] as const) {
  test(`Reasoning summary request: ${model}, opted in ${enabled}`, async () => {
    const oldModel = process.env.OPENAI_MODEL;
    const oldHosted = process.env.CANTE_HOSTED_PROVIDER;
    const oldFetch = globalThis.fetch;
    process.env.OPENAI_MODEL = model;
    process.env.CANTE_HOSTED_PROVIDER = "openai";
    let calls = 0;
    globalThis.fetch = async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.reasoning, expected ? { summary: "auto" } : undefined);
      return eventStream([{ type: "response.output_text.delta", delta: "Answer" }, { type: "response.completed" }]);
    };
    try {
      for await (const _event of new ApiProvider().stream({ system: "Brief", prompt: "Hi", reasoningSummary: enabled })) { /* consume */ }
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = oldFetch;
      if (oldModel === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = oldModel;
      if (oldHosted === undefined) delete process.env.CANTE_HOSTED_PROVIDER; else process.env.CANTE_HOSTED_PROVIDER = oldHosted;
    }
  });
}
