import assert from "node:assert/strict";
import test from "node:test";
import { parseBusinessImpact as parse, evaluateBusinessImpact as evaluate, summarizeBusinessImpact as summarize, exportBusinessImpact as csv } from "./business-impact";
import type { StackedDutyResult } from "./stack";
const header = "sku,hts_code,country_of_origin,supplier,annual_import_value,current_duty_rate";
const input = (rate = "7.5", value = "1000") => `${header}\nA,0101.21.00.10,CA,Acme,${value},${rate}`;
const result = (amount: number | null = 100, rate: number | null = .1, unresolvedMeasures: string[] = []): StackedDutyResult => ({ htsCode: "0101.21.00.10", countryOfOrigin: "CA", totalAmount: amount, totalRatePercent: rate, currency: "USD", components: [], stackingExplanation: [], notEvaluated: [], unresolvedMeasures, adCvdAdvisories: [], usmcaQualification: { status: "not_provided", specialRateRequested: false, explanation: "No evidence" } });
test("aliases and exact percentage semantics including zero and blanks", () => {
  for (const [text, expected] of [["7.5", .075], ["7.5%", .075], ["0.075", .00075], ["0", 0], ["100%", 1]] as const) assert.equal(parse(input(text))[0].current_duty_rate, expected);
  for (const bad of ["", "-1", "101", "NaN", "1e2", "0x10", "%"]) assert.equal(parse(input(bad))[0].status, "error");
  for (const bad of ["", "-1", "Infinity", "oops"]) assert.equal(parse(input("0", bad))[0].status, "error");
  assert.equal(parse(input("0", "0"))[0].input_valid, true);
  const aliases = [
    ["product_code", "htscode", "countryoforigin", "supplier_name", "annual_import_value_usd", "current_duty_rate_percent"],
    ["item_code", "hts", "country", "vendor", "annual_value", "current_rate"],
    ["part_number", "classification", "coo", "supplier", "import_value", "duty_rate"],
  ];
  for (const h of aliases) assert.equal(parse(`${h.join(",")}\nA,0101,CA,S,0,0`)[0].input_valid, true);
  for (const date of ["import_date", "entry_date", "effective_date"]) assert.equal(parse(`${header},${date}\nA,0101,CA,S,1,0,2026-10-06`)[0].evaluation_date, "2026-10-06");
  assert.equal(parse(`${header},import_date\nA,0101,CA,S,1,0,2026-02-30`)[0].status, "error");
});
test("missing fields and conflicts are persisted row errors; duplicates and malformed structure reject", () => {
  assert.equal(parse("sku\nA")[0].status, "error");
  assert.equal(parse(`${header},vendor\nA,0101,CA,S,1,0,Other`)[0].status, "error");
  assert.equal(parse(`${header},vendor\nA,0101,CA,S,1,0,S`)[0].input_valid, true);
  for (const bad of ["", header, `${header},SKU\nA,0101,CA,S,1,0,A`, `${header}\nA,0101`, `${header}\n"unclosed`, `${header}\nA,0101,CA,"S"oops,1,0`, `sku\n${"a".repeat(2001)}`, Array.from({ length: 65 }, (_, i) => `c${i}`).join(",") + "\nx", "sku\n" + "x\n".repeat(5001), header + "\n" + "A,0101,CA,S,0,0\n".repeat(501)]) assert.throws(() => parse(bad));
  assert.equal(parse(header + "\n" + "A,0101,CA,S,0,0\n".repeat(500)).length, 500);
});
test("deltas, fail-closed results, bounded concurrency, value/date forwarding and no USMCA inference", async () => {
  for (const [amount, delta, direction] of [[100, 25, "increase"], [50, -25, "decrease"], [75, 0, "no_change"]] as const) {
    const [row] = await evaluate(parse(input()), async args => { assert.equal(args.value, 1000); assert.equal(args.importDate, null); assert.equal(args.usmcaQualification, undefined); return result(amount); });
    assert.equal(row.annual_delta_usd, delta); assert.equal(row.direction, direction);
  }
  for (const r of [null, result(null), result(100, null), result(100, .1, ["Unknown"])]) {
    const [row] = await evaluate(parse(input()), async () => r);
    assert.equal(row.annual_delta_usd, null); assert.equal(summarize([row]).estimated_annual_duty_delta_usd, null);
  }
  const rows = await evaluate(parse(input()), async () => { throw new Error("secret upstream content"); });
  assert.equal(rows[0].error, "Tariff calculation unavailable."); assert.equal(summarize(rows).accepted_count, 1);
  await evaluate(parse(`${header},entry_date\nA,0101,CA,S,0,0,2026-10-06`), async args => {
    assert.equal(args.importDate, "2026-10-06"); return result(0, 0);
  });
  let active = 0, max = 0;
  await evaluate(parse(header + "\n" + "A,0101,CA,S,0,0\n".repeat(20)), async () => {
    max = Math.max(max, ++active); await new Promise(resolve => setTimeout(resolve, 1)); active--; return result(0, 0);
  });
  assert.equal(max, 5);
});
test("summary distinct counts, resolved subtotal, withholding and date coverage", async () => {
  const rows = await evaluate(parse(input() + "\nA,0101,CA,Acme,1000,7.5\nB,0101,CA,Other,1000,7.5"), async () => result());
  const sum = summarize(rows); assert.equal(sum.affected_sku_count, 2); assert.equal(sum.unique_supplier_count, 2); assert.equal(sum.estimated_annual_duty_delta_usd, 75);
  const partial = summarize([...rows, ...parse(input(""))]); assert.equal(partial.estimated_annual_duty_delta_usd, null); assert.equal(partial.resolved_annual_delta_subtotal_usd, 75);
  assert.equal(sum.effective_date_status, "not_provided");
  rows.forEach(r => { r.evaluation_date = "2026-10-06"; });
  assert.equal(summarize(rows).effective_date_status, "single");
  assert.equal(summarize(rows).effective_date, "2026-10-06");
  rows[0].evaluation_date = null;
  assert.equal(summarize(rows).effective_date_status, "mixed");
  assert.equal(summarize(rows).effective_date, null);
});
test("export RFC4180, formula protection, null blanks and advisory data", () => {
  const row = parse(input())[0]; row.sku = '=HYPERLINK("evil")'; row.supplier = "Acme,\r\nLtd";
  const out = csv([row]); assert.ok(out.includes('"\'=HYPERLINK(""evil"")"')); assert.ok(out.includes('"Acme,\r\nLtd"')); assert.ok(out.includes(',"","","unknown",')); assert.ok(!out.includes('"null"'));
  for (const value of ["+cmd", "-cmd", "@cmd", "\t=cmd"]) { row.sku = value; assert.ok(csv([row]).includes(`"'${value}"`)); }
});

test("streaming body limit cannot be bypassed by missing or false content length", async () => {
  const { readImpactBody, ImpactBodyTooLarge } = await import("./business-impact");
  for (const length of [null, "1", "2097153"]) {
    const headers = new Headers(); if (length) headers.set("content-length", length);
    const request = new Request("https://cante.test", { method: "POST", headers, body: "x".repeat(2097153) });
    await assert.rejects(readImpactBody(request), ImpactBodyTooLarge);
  }
  assert.equal((await readImpactBody(new Request("https://cante.test", { method: "POST", body: "x".repeat(2097152) }))).length, 2097152);
});

test("optional context accepts aliases, bounds values, exports safely and never changes stack inputs", async () => {
  const rows = parse(`${header},qty,ch99,exclusion_number,fta\nA,0101,CA,S,1000,5,0,"9903.01.01, custom",EX-1,USMCA`);
  assert.equal(rows[0].input_valid, true);
  assert.equal(rows[0].quantity, 0);
  assert.equal(rows[0].chapter99_codes, "9903.01.01, custom");
  assert.equal(rows[0].exclusion_id, "EX-1");
  assert.equal(rows[0].special_program_claim, "USMCA");
  await evaluate(rows, async args => {
    assert.deepEqual(Object.keys(args).sort(), ["countryOfOrigin", "htsCode", "importDate", "signal", "value"]);
    return result();
  });
  assert.ok(csv(rows).includes('"quantity","chapter99_codes","exclusion_id","special_program_claim"'));
  assert.ok(csv(rows).includes('"0","9903.01.01, custom","EX-1","USMCA"'));
  for (const qty of ["-1", "NaN", "Infinity", "1e3"]) assert.equal(parse(`${header},quantity\nA,0101,CA,S,1,0,${qty}`)[0].input_valid, false);
  for (const column of ["chapter99_codes", "exclusion_id", "special_program_claim"]) {
    assert.equal(parse(`${header},${column}\nA,0101,CA,S,1,0,${"x".repeat(501)}`)[0].input_valid, false);
    assert.equal(parse(`${header},${column}\nA,0101,CA,S,1,0,${"x".repeat(500)}`)[0].input_valid, true);
  }
  assert.equal(parse(input())[0].quantity, null);
  assert.equal(parse(`${header},qty,quantity\nA,0101,CA,S,1,0,1,2`)[0].input_valid, false);
});
