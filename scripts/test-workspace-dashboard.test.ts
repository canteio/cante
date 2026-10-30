import {DUTY_CALCULATION_VERSION} from "../lib/tariff/duty-expression";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import ts from "typescript";
import {
  parseLiveProducts,
  type LiveCheckResult,
} from "../app/api/tariff/live-check/check";
import { parseCsv } from "../lib/catalogue/csv";
import { normalizeHtsCode, normalizeCountryCode } from "../lib/tariff/bulk";
import {
  tariffFactsFingerprint,
  compareSavedChecks,
  currentCalculationResult,
} from "../app/api/tariff/live-check/comparison";
import { canonicalTableCsv, tablePreviews } from "../app/api/files/tabular";
const code = ts.transpileModule(
  readFileSync("app/api/tariff/workspace-data.ts", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
function api(
  importer: Function = async () => ({
    created: 0,
    updated: 0,
    unchanged: 0,
    rejected: 0,
    caveats: [],
    rows: [],
  }),
  classify: Function = async () => {},
) {
  const exports: any = {};
  const deps: Record<string, unknown> = {
    "@/lib/catalogue/products": { importProductsCsv: importer },
    "@/lib/catalogue/classifications": { recordClassification: classify },
    "@/lib/catalogue/csv": { parseCsv },
    "@/lib/tariff/bulk": { normalizeHtsCode, normalizeCountryCode },
    "./live-check/check": { parseLiveProducts },
  };
  runInThisContext(`(function(require,exports){${code}})`)((name: string) => {
    assert(name in deps, `Unexpected dependency ${name}`);
    return deps[name];
  }, exports);
  return exports;
}
function dbFor(products: any[], codes: any[], failure?: string) {
  const reads: any[] = [];
  const writes: any[] = [];
  return {
    reads,
    writes,
    from(table: string) {
      let payload: unknown;
      const filters: any[] = [];
      const chain: any = {
        select: () => chain,
        update: (p: unknown) => {
          payload = p;
          return chain;
        },
        eq: (...args: any[]) => {
          filters.push(args);
          return chain;
        },
        is: (...args: any[]) => {
          filters.push(args);
          return chain;
        },
        in: (...args: any[]) => {
          filters.push(args);
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        then: (resolve: Function) => {
          if (payload) writes.push({ table, filters, payload });
          else reads.push({ table, filters });
          return resolve({
            data: table === "products" ? products : codes,
            error: failure === table ? { message: "unavailable" } : null,
          });
        },
      };
      return chain;
    },
  };
}
const saved = {
  id: "p1",
  sku: "MOTOR-1",
  name: "Saved motor",
  origin_country: "CN",
  unit_value: 999,
  currency: "EUR",
  tariff_inputs: null,
};
const classification = {
  product_id: "p1",
  code: "8501314000",
  status: "proposed",
};
test("dashboard snapshots include existing products without fabricating customs values from reference prices", async () => {
  const db = dbFor([saved], [classification]);
  const snapshot = await api().loadWorkspaceSnapshot(db, "tenant-a");
  assert.equal(snapshot.count, 1);
  assert.equal(snapshot.products[0].customsValue, null);
  assert.equal(snapshot.products[0].inputBasis, "catalogue");
  assert.equal(snapshot.products[0].hts, "8501.31.40.00");
  assert.equal(snapshot.products[0].quantity, null);
  assert(
    db.reads
      .filter((r) => r.table === "products")
      .every((r) =>
        r.filters.some(
          (f: any[]) => f[0] === "customer_id" && f[1] === "tenant-a",
        ),
      ),
  );
  assert(
    db.reads
      .find((r) => r.table === "product_classifications")
      .filters.some((f: any[]) => f[0] === "product_id" && f[1][0] === "p1"),
  );
  assert.equal(db.writes.length, 0);
});
test("missing/conflicting classifications stay in the catalogue snapshot as unresolved rows", async () => {
  const db = dbFor(
    [saved],
    [classification, { ...classification, code: "8482105048" }],
  );
  const s = await api().loadWorkspaceSnapshot(db, "tenant-a");
  assert.equal(s.products.length, 1);
  assert.equal(s.products[0].hts, "");
  assert.equal(s.products[0].customsValue, null);
});
test("facts for a different code or origin are not silently applied to an edited product", async () => {
  const p = {
    ...saved,
    tariff_inputs: {
      sku: saved.sku,
      hts: "8501.31.40.00",
      origin: "JP",
      customsValue: 10000,
      quantity: 4,
      unit: "No.",
      fictional: false,
      remedyFacts: { standardCommercial: true },
    },
  };
  const s = await api().loadWorkspaceSnapshot(
    dbFor([p], [classification]),
    "tenant-a",
  );
  assert.equal(s.products[0].customsValue, null);
  assert.equal(s.products[0].remedyFacts, undefined);
});
test("matching inputs survive snapshot encoding, including explicit false declarations and historical value basis", async () => {
  const input = {
    sku: saved.sku,
    hts: "8501.31.40.00",
    origin: "CN",
    customsValue: 1500,
    quantity: 12.5,
    unit: "No.",
    fictional: false,
    valueBasis: "historical",
    remedyFacts: {
      standardCommercial: false,
      other232Heading: "none",
      metalWeightPercent: 90,
    },
  };
  const s = await api().loadWorkspaceSnapshot(
    dbFor([{ ...saved, tariff_inputs: input }], [classification]),
    "tenant-a",
  );
  assert.equal(s.products[0].valueBasis, "historical");
  assert.equal(s.products[0].customsValue, 1500);
  assert.equal(s.products[0].quantity, 12.5);
  assert.equal(s.products[0].remedyFacts.standardCommercial, false);
});
test("an oversized catalogue fails visibly rather than checking a silent subset", async () => {
  await assert.rejects(
    api().loadWorkspaceSnapshot(
      dbFor(
        Array.from({ length: 101 }, (_, i) => ({
          ...saved,
          id: String(i),
          sku: String(i),
        })),
        [],
      ),
      "tenant-a",
    ),
    /no subset/,
  );
});
test("catalogue upload preserves missing values and does not reinterpret unit prices as annual exposure", () => {
  const p = api().parseWorkspaceUpload(
    "sku,name,hts,origin,unit_value,currency\nMOTOR-1,Motor,8501314000,China,999,EUR",
  )[0];
  assert.equal(p.customsValue, null);
  assert.equal(p.origin, "CN");
  assert.equal(p.hts, "8501.31.40.00");
  assert.equal(p.valueBasis, undefined);
});
test("chat spreadsheet intake accepts a catalogue without forcing invented annual amounts", () => {
  const tables = [
    {
      label: "Products",
      rows: [
        ["sku", "name", "hts", "origin"],
        ["MOTOR-1", "Motor", "8501314000", "CN"],
      ],
      requiresReview: false,
      issues: [],
    },
  ];
  assert.equal(tablePreviews(tables)[0].basis, "catalogue");
  assert.equal(tablePreviews(tables)[0].ready, true);
  const out = canonicalTableCsv(tables, 0);
  assert.equal(api().parseWorkspaceUpload(out.csv)[0].customsValue, null);
});
test("imports update tenant-scoped tariff facts without replacing saved names, reference prices or approval state", async () => {
  const db = dbFor([saved], []);
  const classifications: any[] = [];
  const imported: any[] = [];
  await api(
    async (...args: any[]) => {
      imported.push(args);
      return {};
    },
    async (p: any) => {
      classifications.push(p);
    },
  ).importWorkspaceProducts(
    db,
    "tenant-a",
    "sku,hts_code,origin_country,annual_customs_value_usd\nMOTOR-1,8501314000,CN,1500",
    "check-original",
  );
  assert.equal(imported.length, 0);
  assert.equal(classifications[0].tier, "lead");
  assert.equal(db.writes.length, 1);
  const write = db.writes[0];
  assert.equal(write.payload.tariff_inputs.customsValue, 1500);
  assert.equal(write.payload.tariff_inputs.sourceCheckId, "check-original");
  assert(!("name" in write.payload));
  assert(!("unit_value" in write.payload));
  assert(
    write.filters.some(
      (f: any[]) => f[0] === "customer_id" && f[1] === "tenant-a",
    ),
  );
});
test("an origin conflict is caught before any catalogue or fact write", async () => {
  const db = dbFor([saved], []);
  let writes = 0;
  await assert.rejects(
    api(async () => {
      writes++;
    }).importWorkspaceProducts(
      db,
      "tenant-a",
      "sku,hts_code,origin_country,annual_customs_value_usd\nMOTOR-1,8501314000,JP,1500",
    ),
    /saved origin differs/,
  );
  assert.equal(writes, 0);
  assert.equal(db.writes.length, 0);
});
function result(): LiveCheckResult {
  return {
    basis: "catalogue",
    valuationBasis: "annual",
    consistentRevision: true,
    checkedAt: "2026-10-22T12:00:00Z",
    totalDuty: 100,
    rows: [
      {
        product: {
          sku: "MOTOR-1",
          hts: "8501.31.40.00",
          origin: "CN",
          customsValue: 1000,
          quantity: null,
          unit: null,
          fictional: false,
          inputBasis: "catalogue",
          valueBasis: "annual",
        },
        stack: {
          totalAmount: 100,
          totalRatePercent: 0.1,
          unresolvedMeasures: [],
        },
        error: null,
        quote: { column: "general", computation: { amount: 10 } },
      },
    ],
  } as any;
}
test("adding a product preserves comparable changes for existing products, while withholding the portfolio difference", () => {
  const before = result(),
    after = structuredClone(before);
  after.rows[0].stack!.totalAmount = 125;
  after.rows.push({
    ...after.rows[0],
    product: { ...after.rows[0].product, sku: "NEW-2" },
  });
  after.totalDuty = null;
  const c = compareSavedChecks(before, after);
  assert.equal(c.rows[0].difference, 25);
  assert.equal(c.rows[1].status, "unresolved");
  assert.equal(c.fullDutyDifference, null);
});
test("an upload's annual baseline and next dashboard refresh compare the same calculation facts", () => {
  const before = result(),
    after = result();
  before.basis = "annual";
  delete before.rows[0].product.inputBasis;
  delete before.rows[0].product.valueBasis;
  after.rows[0].stack!.totalAmount = 125;
  after.totalDuty = 125;
  const c = compareSavedChecks(before, after);
  assert.equal(c.fullDutyDifference, 25);
});
test("rate changes can be shown without inventing a dollar cost when customs values are missing", () => {
  const before = result(),
    after = result();
  before.totalDuty = after.totalDuty = null;
  before.rows[0].product.customsValue = after.rows[0].product.customsValue =
    null;
  before.rows[0].stack!.totalAmount = after.rows[0].stack!.totalAmount = null;
  after.rows[0].stack!.totalRatePercent = 0.15;
  const c = compareSavedChecks(before, after);
  assert.equal(c.rows[0].status, "rate_changed");
  assert.equal(c.rows[0].rateDifference, 0.05);
  assert.equal(c.fullDutyDifference, null);
});
test("updating one fact preserves supplied quantities and qualifications that were not edited", async () => {
  const input = {
    sku: saved.sku,
    hts: "8501.31.40.00",
    origin: "CN",
    customsValue: 1500,
    quantity: 20,
    unit: "No.",
    fictional: false,
    valueBasis: "annual",
    remedyFacts: { standardCommercial: true, other232Heading: "none" },
  };
  const db = dbFor([{ ...saved, tariff_inputs: input }], []);
  await api().importWorkspaceProducts(
    db,
    "tenant-a",
    "sku,hts_code,origin_country,input_basis,standard_commercial\nMOTOR-1,8501314000,CN,catalogue,",
  );
  const stored = db.writes[0].payload.tariff_inputs;
  assert.equal(stored.customsValue, 1500);
  assert.equal(stored.quantity, 20);
  assert.equal(stored.unit, "No.");
  assert.equal(stored.remedyFacts.standardCommercial, undefined);
  assert.equal(stored.remedyFacts.other232Heading, "none");
});
test("upload plus checking uses the long check admission once, bound to authenticated workspace", async () => {
  const code = ts.transpileModule(
    readFileSync("app/api/tariff/workspace/import/route.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const calls: any[] = [];
  const exports: any = {};
  const file = {
    filename: "Products.csv",
    format: "csv",
    text: "",
    originalCsv: "sku\nA",
  };
  const deps: Record<string, unknown> = {
    "@/app/api/request-limits": {
      withRequestLimit: async (
        req: Request,
        operation: string,
        bytes: number,
        handler: Function,
      ) => {
        calls.push(["admission", operation, bytes]);
        return handler(req);
      },
    },
    "@/lib/supabase/server": {
      getAuthenticatedWorkspace: async () => ({
        customerId: "tenant-a",
        role: "owner",
      }),
    },
    "@/app/api/files/prepare-chat-upload": {
      prepareChatUpload: async (customerId: string) => {
        assert.equal(customerId, "tenant-a");
        return { csv: file };
      },
    },
    "@/app/api/chat/csv-check": {
      checkChatCsv: async (...args: any[]) => {
        assert.equal(args[0], "tenant-a");
        assert.equal(args[1], file);
        assert.equal(
          args[6],
          true,
          "a held check lease must not be reserved again",
        );
        assert.equal(args[2].aborted, false);
        return { checkId: "saved-check", result: result() };
      },
    },
  };
  runInThisContext(`(function(require,exports){${code}})`)((name: string) => {
    assert(name in deps);
    return deps[name];
  }, exports);
  const response = await exports.POST(
    new Request("https://cante.test/api/tariff/workspace/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploadId: "original",
        customerId: "another-tenant",
      }),
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [["admission", "check", 15 * 1024 * 1024]]);
  assert.match(await response.text(), /"type":"done"/);
});

test("saved JSONB key order does not falsely mark current dashboard facts as edited", () => {
  assert.equal(
    tariffFactsFingerprint([
      1000,
      { standardCommercial: true, other232Heading: "none" },
    ]),
    tariffFactsFingerprint([
      1000,
      { other232Heading: "none", standardCommercial: true },
    ]),
  );
});

// Old attestations remain valid archive evidence, but cannot claim a regulatory delta.
test("a calculation-method change establishes a new baseline without inventing regulatory impact",()=>{
 const old=result(),fresh=result();fresh.calculationVersion=DUTY_CALCULATION_VERSION;
 fresh.rows[0].stack!.totalAmount=100.01;
 const comparison=compareSavedChecks(old,fresh);
 assert.equal(comparison.status,"unavailable");assert.match(comparison.reason!,/calculation method changed/);
 assert.equal(comparison.fullDutyDifference,null);assert.equal(comparison.changedProducts,null);assert.deepEqual(comparison.rows,[]);
 assert.equal(currentCalculationResult(old),null);
 assert.equal(currentCalculationResult({...old,calculationVersion:"unknown-future-method"}),null);
 assert.equal(currentCalculationResult(fresh),fresh);
 old.calculationVersion=DUTY_CALCULATION_VERSION;
 assert.equal(compareSavedChecks(old,fresh).fullDutyDifference,0.01);
 assert.equal(old.rows[0].stack!.totalAmount,100);
});

test("the bounded 100-product comparison adds cent differences exactly",()=>{
 const before=result(),after=result();
 const row=before.rows[0];
 before.rows=Array.from({length:100},(_,i)=>({...structuredClone(row),product:{...row.product,sku:`SYN-${i}`}}));
 after.rows=structuredClone(before.rows);
 before.rows.forEach(r=>r.stack!.totalAmount=1000.50);after.rows.forEach(r=>r.stack!.totalAmount=1000.51);
 const comparison=compareSavedChecks(before,after);
 assert.equal(comparison.changedProducts,100);assert.equal(comparison.fullDutyDifference,1);
 assert.equal(comparison.baseDutyDifference,0);
 assert.ok(comparison.rows.every(r=>r.difference===0.01));
});
