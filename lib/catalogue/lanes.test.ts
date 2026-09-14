import assert from "node:assert/strict";
import test from "node:test";
import { annualShipmentsOf } from "./lanes";
import type { TradeLane } from "@/lib/db/schema";

/**
 * annualShipmentsOf is the only place that turns a lane's shipment cadence
 * into a number the exposure maths in lib/impact can use. It has two
 * legitimate sources — an explicit count, or an unambiguous frequency label —
 * and must not invent precision when neither is present.
 */

function makeLane(overrides: Partial<TradeLane> = {}): TradeLane {
  return {
    id: "lane-1",
    customerId: "cust-1",
    productId: null,
    direction: "export",
    originCountry: "Indonesia",
    destinationCountry: "United States",
    transitCountries: [],
    supplierId: null,
    brokerName: null,
    brokerContact: null,
    incoterm: null,
    shipmentFrequency: "unknown",
    annualShipments: null,
    annualValue: null,
    annualVolume: null,
    volumeUnit: null,
    currency: "USD",
    nextShipmentAt: null,
    active: true,
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as TradeLane;
}

test("annualShipmentsOf prefers an explicit positive count over the label", () => {
  const lane = makeLane({ annualShipments: 40, shipmentFrequency: "weekly" });
  assert.equal(annualShipmentsOf(lane), 40);
});

test("annualShipmentsOf ignores a zero or negative explicit count and falls back to the label", () => {
  assert.equal(annualShipmentsOf(makeLane({ annualShipments: 0, shipmentFrequency: "monthly" })), 12);
  assert.equal(annualShipmentsOf(makeLane({ annualShipments: -3, shipmentFrequency: "quarterly" })), 4);
});

test("annualShipmentsOf maps every known frequency label to its annual count", () => {
  assert.equal(annualShipmentsOf(makeLane({ shipmentFrequency: "weekly" })), 52);
  assert.equal(annualShipmentsOf(makeLane({ shipmentFrequency: "fortnightly" })), 26);
  assert.equal(annualShipmentsOf(makeLane({ shipmentFrequency: "monthly" })), 12);
  assert.equal(annualShipmentsOf(makeLane({ shipmentFrequency: "quarterly" })), 4);
  assert.equal(annualShipmentsOf(makeLane({ shipmentFrequency: "annually" })), 1);
});

test("annualShipmentsOf returns null rather than guessing for an unmapped or unknown label", () => {
  assert.equal(annualShipmentsOf(makeLane({ shipmentFrequency: "unknown" })), null);
  assert.equal(annualShipmentsOf(makeLane({ shipmentFrequency: "ad_hoc" })), null);
});
