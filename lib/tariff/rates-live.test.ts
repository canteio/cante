import assert from "node:assert/strict";
import test from "node:test";
import { quoteDuty, resetTariffCacheForTests } from "./rates";
import { evaluateBusinessImpact, parseBusinessImpact } from "./business-impact";
import coverage from "./section301-coverage.json";

// Deliberately live: unavailable USITC is a failure, never a skip or mock.
test("live USITC housing leaf inherits a published ad valorem rate", { timeout: 85_000 }, async () => {
  resetTariffCacheForTests();
  const quote = await quoteDuty({ htsCode: "8538.90.8180", value: 8000, signal: AbortSignal.timeout(80_000) });
  assert.ok(quote);
  assert.equal(quote.htsCode, "8538.90.8180");
  assert.equal(quote.rate.parsed, true);
  assert.equal(quote.rate.specificAmount, null);
  assert.ok(quote.rate.adValorem !== null && Number.isFinite(quote.rate.adValorem));
  assert.ok(quote.caveats.some(note => /inherited.*8538\.90\.81/.test(note)));
  assert.notEqual(quote.computation.amount, null);
});

test("live enriched BOM retains base and List 1 evidence and withholds an incomplete total", { timeout: 85_000 }, async () => {
  assert.equal(coverage.coverage["85389081"], "9903.88.01");
  const rows = await evaluateBusinessImpact(parseBusinessImpact([
    "sku,hts,origin,supplier,annual_import_value_usd,current_duty_rate,evaluation_date",
    "TAZ-MOTOR,8501.10.40.20,CN,Moons Industries,145000,4.4,2026-10-01",
    "TAZ-BEARING,8482.10.50,DE,Igus GmbH,38000,9,2026-10-01",
    "TAZ-CONNECTOR-HOUSING,8538.90.8180,CN,Connector supplier,8000,3.5,2026-10-01",
  ].join("\n")), undefined, AbortSignal.timeout(80_000));
  assert.equal(rows.length, 3);
  const housing = rows[2];
  if (housing.stack_result!.unresolvedMeasures.length) {
    assert.equal(housing.status, "unresolved");
    assert.equal(housing.computed_annual_duty_usd, null);
    assert.equal(housing.annual_delta_usd, null);
  } else {
    assert.equal(housing.status, "computed");
    assert.equal(housing.computed_annual_duty_usd, housing.stack_result!.totalAmount);
  }
  const section301 = housing.stack_result?.components.find(component => component.type === "section301");
  assert.equal(section301?.ratePercent, 0.25);
  // Confirmed supplied snapshot; update if a future HTS revision changes base duty.
  assert.equal(housing.stack_result?.components.find(c => c.type === "base")?.amount, 280);
  assert.equal(section301?.amount, 2000);
  assert.ok(housing.stack_result?.components.some(component => /inherited.*8538\.90\.81/.test(component.explanation)));
});
