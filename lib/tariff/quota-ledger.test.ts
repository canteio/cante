import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateQuotaHealth,
  recordQuotaDeduction,
  type QuotaPermit,
} from "./quota-ledger";

test("recordQuotaDeduction deducts volume and rejects over-allocation", () => {
  const permit: QuotaPermit = {
    id: "Q-001",
    permitNumber: "PI-PLASTIK-2026-001",
    permitType: "PI_BAHAN_BAKU",
    issuingAgency: "Kemendag",
    commodityDescription: "PVC Resin Primary Forms",
    hsCode: "3904.10.00",
    allocatedQuantity: 1000,
    unit: "MT",
    validFrom: "2026-01-01T00:00:00Z",
    validUntil: "2026-12-31T23:59:59Z",
    deductions: [],
  };

  // Deduct 400 MT
  const ded1 = recordQuotaDeduction(permit, {
    shipmentReference: "SHP-001",
    pibOrEntryNumber: "PIB-123456",
    quantityDeducted: 400,
  });

  assert.equal(ded1.isAllowed, true);
  assert.equal(ded1.updatedPermit.deductions.length, 1);

  // Attempt to deduct 700 MT (exceeds 600 MT remaining)
  const ded2 = recordQuotaDeduction(ded1.updatedPermit, {
    shipmentReference: "SHP-002",
    pibOrEntryNumber: "PIB-999999",
    quantityDeducted: 700,
  });

  assert.equal(ded2.isAllowed, false);
  assert.match(ded2.error!, /exceeds remaining quota balance of 600 MT/);
});

test("evaluateQuotaHealth calculates burn rate, depletion date, and renewal warnings", () => {
  const now = new Date("2026-08-01T00:00:00Z"); // Day ~212
  const permit: QuotaPermit = {
    id: "Q-002",
    permitNumber: "PI-TPT-2026-999",
    permitType: "PI_TPT",
    issuingAgency: "Kemendag",
    commodityDescription: "Polyester Coated Fabric",
    hsCode: "5903.10.00",
    allocatedQuantity: 500,
    unit: "MT",
    validFrom: "2026-01-01T00:00:00Z",
    validUntil: "2026-08-30T23:59:59Z", // 29 days left (<30d)
    deductions: [
      { id: "D1", shipmentReference: "S1", pibOrEntryNumber: "P1", quantityDeducted: 450, deductedAt: "2026-07-01T00:00:00Z" },
    ],
  };

  const health = evaluateQuotaHealth(permit, now);
  assert.equal(health.totalAllocated, 500);
  assert.equal(health.totalRealized, 450);
  assert.equal(health.remainingBalance, 50);
  assert.equal(health.utilizationPercent, 90.0);
  assert.equal(health.daysUntilExpiration, 30);
  assert.equal(health.status, "RENEWAL_WARNING");
  assert.ok(health.alerts.some((a) => a.includes("URGENT: Quota")));
  assert.ok(health.projectedDepletionDate !== null);
});
