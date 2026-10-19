/** One explicit live API call through the real chat route; database access is forbidden. */
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import assert from "node:assert/strict";
import ts from "typescript";
import * as demo from "../components/tariff/demo-scenario";
import { getProvider } from "../lib/llm";
import { normalizeJurisdiction } from "../lib/countries";
async function main() {
  const compiled = ts.transpileModule(readFileSync("app/api/chat/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  let dbTouches = 0, apiCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { if (String(url).includes("api.openai.com/v1/responses")) apiCalls++; return originalFetch(url, init); };
  const forbidden = new Proxy({}, { get() { return () => { dbTouches++; throw new Error("Demo attempted to access real customer data"); }; } });
  const queries = new Proxy({}, { get(_target, name) { return name === "resolveCustomerId" ? async () => "isolated-demo-test" : () => { dbTouches++; throw new Error(`Forbidden database access: ${String(name)}`); }; } });
  const deps: Record<string, unknown> = {
    "@/components/tariff/demo-scenario": demo, "@/lib/db/queries": queries,
    "@/lib/llm": { getProvider: (choice: string) => { assert.equal(choice, "api"); return getProvider(choice); } },
    "@/lib/countries": { normalizeJurisdiction }, "@/lib/checks/remember": forbidden,
    "@/lib/chat/attachments": forbidden, "@/lib/supabase/server": forbidden,
  };
  const route: { POST?: (request: Request) => Promise<Response> } = {};
  const load = runInThisContext(`(function(require, exports) { ${compiled}\n })`);
  load((id: string) => { assert(id in deps, `Unexpected module: ${id}`); return deps[id]; }, route);
  try {
    const response = await route.POST!(new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: demo.DEMO_QUESTION, country: "United States", demoScenario: { catalogueCsv: demo.catalogueCsv(), historyCsv: demo.historyCsv(), regulationId: "sim-cn-25", totalExtraCents: 1 } }) }));
    assert.equal(response.status, 200);
    const events = (await response.text()).split("\n\n").filter(frame => frame.startsWith("data: ")).map(frame => JSON.parse(frame.slice(6)));
    const answer = events.filter(e => e.type === "text").map(e => e.text).join("");
    assert.equal(events.some(e => e.type === "error"), false, JSON.stringify(events.find(e => e.type === "error")));
    assert.match(answer, /8,817,300/); assert.match(answer, /18/); assert.match(answer, /734,775/);
    assert.match(answer, /hypothetical|fictional|simulat/i);
    assert.equal(dbTouches, 0); assert.equal(apiCalls, 1);
    assert.equal(events.some(e => e.type === "tool_start"), false);
    console.log(JSON.stringify({ question: demo.DEMO_QUESTION, answer, apiCalls, customerDataReadsOrWrites: dbTouches }, null, 2));
  } finally { globalThis.fetch = originalFetch; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
