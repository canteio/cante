import assert from "node:assert/strict";
import { test } from "node:test";
import type { ImportShipmentRow } from "../schema/shipments";
import { queryShipments } from "./search-shipments";

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
