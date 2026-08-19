import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateImportTaxExposure,
  getLartasSummary,
  lookupInswTariff,
  normalizeHsCode,
} from "./insw";

test("normalizeHsCode extracts numeric digits", () => {
  assert.equal(normalizeHsCode("3904.10.10"), "39041010");
  assert.equal(normalizeHsCode("6306.19"), "630619");
  assert.equal(normalizeHsCode("HS 2917.34.00"), "29173400");
});

test("lookupInswTariff finds raw material polymer and chemical tariffs", () => {
  const pvc = lookupInswTariff("3904.10");
  assert.ok(pvc);
  assert.equal(pvc.dutyRates.importDutyPercent, 5);
  assert.equal(pvc.dutyRates.ppnPercent, 11);
  assert.equal(pvc.dutyRates.pphPercentApi, 2.5);
  assert.equal(pvc.lartas.import.restricted, true);

  const dop = lookupInswTariff("2917.34.00");
  assert.ok(dop);
  assert.equal(dop.lartas.import.requirements[0].agency, "KLHK");

  const unknown = lookupInswTariff("9999.99");
  assert.equal(unknown, null);
});

test("calculateImportTaxExposure performs precise Indonesian import tax arithmetic", () => {
  const pvc = lookupInswTariff("3904.10")!;
  const cif = 100_000_000; // 100M IDR shipment

  // With API (2.5% PPh 22)
  const calcWithApi = calculateImportTaxExposure(cif, pvc, true);
  assert.equal(calcWithApi.beaMasuk, 5_000_000); // 5% of 100M = 5M
  assert.equal(calcWithApi.nilaiImpor, 105_000_000); // CIF + BM = 105M
  assert.equal(calcWithApi.ppn, 11_550_000); // 11% of 105M = 11.55M
  assert.equal(calcWithApi.pph22, 2_625_000); // 2.5% of 105M = 2.625M
  assert.equal(calcWithApi.totalImportTax, 19_175_000); // 5M + 11.55M + 2.625M = 19.175M
  assert.equal(calcWithApi.effectiveRatePercent, 19.18);

  // Without API (7.5% PPh 22)
  const calcNoApi = calculateImportTaxExposure(cif, pvc, false);
  assert.equal(calcNoApi.pph22, 7_875_000); // 7.5% of 105M = 7.875M
  assert.equal(calcNoApi.totalImportTax, 24_425_000); // 5M + 11.55M + 7.875M = 24.425M
  assert.equal(calcNoApi.effectiveRatePercent, 24.43);
});

test("getLartasSummary formats import and export restrictions correctly", () => {
  const fabric = lookupInswTariff("5903.10")!;
  const importLartas = getLartasSummary(fabric, "import");
  assert.equal(importLartas.restricted, true);
  assert.ok(importLartas.notes.some((n) => n.includes("PI TPT")));
  assert.ok(importLartas.notes.some((n) => n.includes("Laporan Surveyor")));

  const tarpaulin = lookupInswTariff("6306.19")!;
  const exportLartas = getLartasSummary(tarpaulin, "export");
  assert.equal(exportLartas.restricted, false);
  assert.ok(exportLartas.notes.some((n) => n.includes("PEB")));
});
