import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { stackingConditions } from "../lib/tariff/stacking-authoring-contract";

const id = "12345678-1234-4234-8234-123456789abc";
function load(path: string, dependencies: Record<string, unknown>) {
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: any = {};
  runInThisContext(`(function(require,exports){${code}\n})`)((key: string) => {
    assert(key in dependencies, `Unexpected dependency: ${key}`); return dependencies[key];
  }, exports);
  return exports;
}
function handler(role: string | null, appointed = false, rpcError?: { code: string }) {
  const calls: any[] = [];
  const api = load("app/api/tariff/stacking-rules/route.ts", {
    "@/app/api/request-limits": {withRequestLimit:async(r:Request,_op:string,_max:number,handler:Function)=>handler(r)},
    zod: { z }, "@/lib/tariff/stacking-authoring-contract": { stackingConditions },
    "@/lib/tariff/stacking-authoring": { retryStackingAuthoringJob: async () => { calls.push("retry"); } },
    "@/lib/supabase/server": {
      getAuthenticatedWorkspace: async () => role ? { role, userId: id, customerId: id } : null,
      isPlatformTariffReviewer: async () => appointed,
      createRequestClient: async () => ({ rpc: async (...args: any[]) => { calls.push(args); return { data: id, error: rpcError }; } }),
    },
  });
  return { api, calls };
}
const request = (decision = "confirm", extra = {}) => new Request("https://cante.test/api/tariff/stacking-rules", {
  method: "POST", body: JSON.stringify({ id, decision, sourceRead: true, note: "Reviewed the official source", ...extra }),
});
for (const role of [null, "owner", "admin", "member", "viewer"]) {
  test(`${role ?? "anonymous"} cannot read, confirm, reject or retry shared rules without appointment`, async () => {
    const h = handler(role);
    assert.equal((await h.api.GET(new Request("https://cante.test/api/tariff/stacking-rules"))).status, role ? 403 : 401);
    for (const decision of ["confirm", "reject", "retry"]) assert.equal((await h.api.POST(request(decision))).status, role ? 403 : 401);
    assert.equal(h.calls.length, 0);
  });
}
test("an appointed reviewer need not be a tenant administrator; caller cannot choose reviewer identity", async () => {
  const h = handler("member", true);
  assert.equal((await h.api.GET(new Request("https://cante.test/api/tariff/stacking-rules"))).status, 200);
  assert.equal((await h.api.POST(request())).status, 200);
  assert.equal(h.calls[1][0], "review_tariff_stacking_draft_authenticated");
  assert(!("reviewer_id" in h.calls[1][1]));
  assert.equal((await h.api.POST(request("reject", { reviewer_id: id }))).status, 400);
  assert.equal((await h.api.POST(request("confirm", { sourceRead: false }))).status, 400);
});
test("revocation between API precheck and database operation is denied", async () => {
  const h = handler("owner", true, { code: "42501" });
  assert.equal((await h.api.GET(new Request("https://cante.test/api/tariff/stacking-rules"))).status, 403);
  assert.equal((await h.api.POST(request("reject"))).status, 403);
});
for (const result of [{ data: true, error: null }, { data: false, error: null }, { data: "true", error: null }, { data: true, error: { code: "unavailable" } }, null]) {
  test(`reviewer capability fails closed: ${JSON.stringify(result)}`, async () => {
    const server = load("lib/supabase/server.ts", {
      "@supabase/ssr": { createServerClient: () => ({ rpc: async (name: string) => { assert.equal(name, "is_platform_tariff_reviewer"); if (!result) throw Error("Offline"); return result; } }) },
      "next/headers": { cookies: async () => ({ getAll: () => [] }) },
      "@/lib/auth/config": { requireSupabaseEnv: () => ({ url: "https://fixture.supabase.co", publishableKey: "fixture" }) },
    });
    assert.equal(await server.isPlatformTariffReviewer(), result?.data === true && !result.error);
  });
}
