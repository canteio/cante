import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import ts from "typescript";
import * as demoScenario from "../../components/tariff/demo-scenario";

// Execute the real route, stopping at provider availability: no live provider,
// conversation writes, or database reads beyond the mocked workspace resolution.
const source = readFileSync("app/api/chat/route.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

for (const locked of ["true", "false"]) {
  test(`chat stays API-only with stale CLI settings (locked=${locked})`, async () => {
    const previous = process.env.CANTE_LLM_LOCKED;
    process.env.CANTE_LLM_LOCKED = locked;
    const selected: unknown[] = [];
    const dependencies: Record<string, unknown> = {
      "@/app/api/request-limits": {withRequestLimit:async(request:Request,_op:string,_max:number,handler:Function)=>handler(request)},
      "@/components/tariff/demo-scenario": demoScenario,
      "@/lib/db/queries": { resolveCustomerId: async () => "owned-workspace" },
      "@/lib/llm": {
        // Simulate the historical normalizer default that caused the regression.
        normalizeProviderChoice: (value: unknown) => value ?? "claude-code",
        PROVIDER_COOKIE: "cante_llm",
        getProvider: (choice: unknown) => {
          selected.push(choice);
          return { available: async () => ({ ok: false, detail: "API unavailable; no CLI fallback." }) };
        },
      },
      "@/lib/checks/remember": {}, "@/lib/countries": {},
      "@/lib/chat/attachments": {}, "@/lib/supabase/server": {},
    };
    const route: { POST?: (request: Request) => Promise<Response> } = {};
    const load = runInThisContext(`(function(require, exports) { ${compiled}\n })`);
    load((id: string) => {
      if (!(id in dependencies)) throw Error(`Unexpected dependency: ${id}`);
      return dependencies[id];
    }, route);
    try {
      const response = await route.POST!(new Request("https://cante.test/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: "cante_llm=claude-code" },
        body: JSON.stringify({ question: "Help me", provider: "claude-code" }),
      }));
      assert.equal(response.status, 503);
      assert.match((await response.json()).error, /no CLI fallback/);
      assert.deepEqual(selected, ["api"]);
    } finally {
      if (previous === undefined) delete process.env.CANTE_LLM_LOCKED;
      else process.env.CANTE_LLM_LOCKED = previous;
    }
  });
}

test("temporarily rejects Indonesia chat before starting a provider or database operation", async () => {
  const route: { POST?: (request: Request) => Promise<Response> } = {};
  const load = runInThisContext(`(function(require, exports) { ${compiled}\n })`);
  load((id: string) => {
    if (id === "@/app/api/request-limits") return {withRequestLimit:async(r:Request,_op:string,_max:number,h:Function)=>h(r)};
    if (id === "@/lib/countries") return { normalizeJurisdiction: () => "Indonesia" };
    return new Proxy({}, { get() { throw Error("Indonesia request reached a disabled operation"); } });
  }, route);
  const response = await route.POST!(new Request("https://cante.test/api/chat", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "Help me", country: "Indonesia" }),
  }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /United States only/);
});

for (const invalid of [false, true]) {
  test(`fictional scenario ${invalid ? "rejects invalid inputs" : "recomputes totals and streams context"} without customer data access`, async () => {
    let calls = 0, prompt = "";
    const forbidden = new Proxy({}, { get() { throw Error("Demo touched customer data or memory"); } });
    const deps: Record<string, unknown> = {
      "@/app/api/request-limits": {withRequestLimit:async(r:Request,_op:string,_max:number,h:Function)=>h(r)},
      "@/components/tariff/demo-scenario": demoScenario,
      "@/lib/db/queries": new Proxy({}, { get(_target, name) { return name === "resolveCustomerId" ? async () => "demo-test" : () => { throw Error(`Demo called ${String(name)}`); }; } }),
      "@/lib/llm": { getProvider: () => ({ name: "api", available: async () => ({ ok: true }), async *stream(options: any) { calls++; prompt = options.prompt; assert.deepEqual(options.tools, []); yield { type: "text", text: "Fixture explanation" }; yield { type: "done" }; } }) },
      "@/lib/countries": { normalizeJurisdiction: () => "United States" },
      "@/lib/checks/remember": forbidden, "@/lib/chat/attachments": forbidden, "@/lib/supabase/server": forbidden,
    };
    const route: { POST?: (request: Request) => Promise<Response> } = {};
    runInThisContext(`(function(require, exports) { ${compiled}\n })`)((id: string) => { assert(id in deps); return deps[id]; }, route);
    const response = await route.POST!(new Request("https://cante.test/api/chat", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: demoScenario.DEMO_QUESTION, demoScenario: { catalogueCsv: demoScenario.catalogueCsv(), historyCsv: demoScenario.historyCsv(), regulationId: invalid ? "not-a-rule" : "sim-cn-25", totalExtraCents: 1 } }),
    }));
    assert.equal(response.status, invalid ? 400 : 200);
    const body = await response.text();
    if (invalid) assert.equal(calls, 0);
    else { assert.equal(calls, 1); assert.match(prompt, /\$8,817,300\.00/); assert.match(prompt, /Fictional tariff demo/); assert.match(body, /Fixture explanation/); assert.doesNotMatch(body, /"type":"conversation"/); }
  });
}
