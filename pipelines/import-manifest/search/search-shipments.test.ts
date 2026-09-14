import assert from "node:assert/strict";
import { test } from "node:test";
import type { ImportShipmentRow } from "../schema/shipments";
import type { RegulationEntry } from "@/lib/sources/fetch";
import { queryShipments, queryShipmentsWithRecallMatches } from "./search-shipments";

/** Minimal valid RegulationEntry for test fixtures (mirrors
 * match/match-shipment-recalls.test.ts's fixture shape). */
function recall(overrides: Partial<RegulationEntry> = {}): RegulationEntry {
  return {
    sourceId: "us-cpsc-recalls",
    sourceName: "CPSC - recent product recalls",
    domain: "www.saferproducts.gov",
    regulationType: "standards",
    label: "CPSC recall 26-404",
    number: "26-404",
    year: 2026,
    listingTitle: "Supernova Butane Torch Lighters Recalled",
    truncated: false,
    fullTitle:
      "Supernova and Typhoon butane torch lighters recalled for lacking " +
      "required child-resistant mechanism. Recall date 2026-04-09.",
    url: "https://www.cpsc.gov/Recalls/2026/recall-26-404",
    foundInViews: ["cpsc-recalls"],
    ...overrides,
  };
}

/** Minimal fixture builder — fills required non-nullable columns, lets
 * callers override just the fields a given test cares about. */
function makeRow(overrides: Partial<ImportShipmentRow>): ImportShipmentRow {
  return {
    id: "row-1",
    billOfLading: "BOL123",
    carrierScac: null,
    manifestSequenceNumber: null,
    vesselName: null,
    vesselImoCode: null,
    voyageNumber: null,
    portOfLadingCode: null,
    portOfUnladingCode: null,
    shipperName: null,
    shipperAddress: null,
    shipperCountryCode: null,
    consigneeName: null,
    consigneeAddress: null,
    dataRedacted: false,
    cargoDescription: null,
    hsChapter: null,
    grossWeightKg: null,
    packageCount: null,
    containerNumbers: null,
    estimatedArrivalDate: null,
    manifestFiledDate: null,
    sourceType: "sample_fixture",
    sourceFileRef: null,
    ingestedAt: "2026-09-14T00:00:00.000Z",
    ...overrides,
  };
}

test("queryShipments filters by exact shipperCountryCode", () => {
  const rows = [
    makeRow({ id: "cn", shipperCountryCode: "CN" }),
    makeRow({ id: "id", shipperCountryCode: "ID" }),
  ];
  const result = queryShipments(rows, { shipperCountryCode: "CN" });
  assert.deepEqual(result.map((r) => r.id), ["cn"]);
});

test("queryShipments does case-insensitive substring match on cargoDescription", () => {
  const rows = [
    makeRow({ id: "match", cargoDescription: "Infant Baby Stroller Parts" }),
    makeRow({ id: "no-match", cargoDescription: "Steel Fasteners" }),
  ];
  const result = queryShipments(rows, { cargoDescriptionContains: "baby" });
  assert.deepEqual(result.map((r) => r.id), ["match"]);
});

test("queryShipments excludes redacted rows when excludeRedacted is set", () => {
  const rows = [
    makeRow({ id: "open", dataRedacted: false }),
    makeRow({ id: "redacted", dataRedacted: true }),
  ];
  const result = queryShipments(rows, { excludeRedacted: true });
  assert.deepEqual(result.map((r) => r.id), ["open"]);
});

test("queryShipments combines multiple filters with AND semantics", () => {
  const rows = [
    makeRow({
      id: "hit",
      shipperCountryCode: "CN",
      hsChapter: "95",
      consigneeName: "Acme Toy Co",
    }),
    makeRow({
      id: "wrong-hs",
      shipperCountryCode: "CN",
      hsChapter: "84",
      consigneeName: "Acme Toy Co",
    }),
  ];
  const result = queryShipments(rows, {
    shipperCountryCode: "CN",
    hsChapter: "95",
    consigneeNameContains: "acme",
  });
  assert.deepEqual(result.map((r) => r.id), ["hit"]);
});

test("queryShipments returns all rows when no filters are given", () => {
  const rows = [makeRow({ id: "a" }), makeRow({ id: "b" })];
  const result = queryShipments(rows, {});
  assert.equal(result.length, 2);
});

test("queryShipments treats null fields as non-matching for substring filters", () => {
  const rows = [makeRow({ id: "null-desc", cargoDescription: null })];
  const result = queryShipments(rows, { cargoDescriptionContains: "baby" });
  assert.deepEqual(result, []);
});

test("queryShipmentsWithRecallMatches filters then ranks recall overlap, dropping zero-match rows by default", () => {
  const rows = [
    makeRow({
      id: "lighter-importer",
      shipperCountryCode: "CN",
      cargoDescription: "Butane torch lighters, child-resistant mechanism",
    }),
    makeRow({
      id: "unrelated-importer",
      shipperCountryCode: "CN",
      cargoDescription: "Steel fasteners and hardware",
    }),
  ];
  const recalls = [recall()];
  const result = queryShipmentsWithRecallMatches(
    rows,
    { shipperCountryCode: "CN" },
    recalls,
  );
  assert.deepEqual(result.map((r) => r.shipment.id), ["lighter-importer"]);
  assert.equal(result[0].recallMatches.length, 1);
  assert.equal(result[0].recallMatches[0].recall.number, "26-404");
});

test("queryShipmentsWithRecallMatches keeps zero-match rows when onlyWithMatches is false", () => {
  const rows = [
    makeRow({ id: "unrelated", cargoDescription: "Steel fasteners" }),
  ];
  const result = queryShipmentsWithRecallMatches(
    rows,
    {},
    [recall()],
    { onlyWithMatches: false },
  );
  assert.deepEqual(result.map((r) => r.shipment.id), ["unrelated"]);
  assert.equal(result[0].recallMatches.length, 0);
});
