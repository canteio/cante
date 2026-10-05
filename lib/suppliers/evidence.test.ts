import assert from "node:assert/strict";
import test, { before } from "node:test";
import { operatingDb } from "@/lib/test-support/supabase-test-db";


test("never-requested, waiting, and expired are three different answers", async () => {
  const { customerId } = await operatingDb();
  const { upsertSupplier } = await import("@/lib/catalogue/lanes");
  const { upsertEvidence, evidenceGaps } = await import("@/lib/suppliers/evidence");

  const never = (await upsertSupplier(customerId, { name: "Supplier Never" }));
  const waiting = (await upsertSupplier(customerId, { name: "Supplier Waiting" }));
  const expired = (await upsertSupplier(customerId, { name: "Supplier Expired" }));

  (await upsertEvidence({ supplierId: never.id, docType: "reach", status: "not_requested" }));
  (await upsertEvidence({ supplierId: waiting.id, docType: "reach", status: "requested" }));
  (await upsertEvidence({
    supplierId: expired.id,
    docType: "reach",
    status: "received",
    expiresAt: "2026-01-01",
  }));

  const gaps = (await evidenceGaps(customerId, { now: new Date("2026-08-16T00:00:00Z") }));
  const byName = new Map(gaps.map((g) => [g.supplier.name, g]));

  assert.equal(byName.get("Supplier Never")?.status, "not_requested");
  assert.match(byName.get("Supplier Never")?.detail ?? "", /never been requested/);
  assert.equal(byName.get("Supplier Waiting")?.status, "requested");
  assert.equal(byName.get("Supplier Expired")?.status, "expired");
  assert.equal(byName.get("Supplier Expired")?.severity, "high");
});

test("a supplier nobody has ever asked anything is flagged, not assumed compliant", async () => {
  const { customerId } = await operatingDb();
  const { upsertSupplier } = await import("@/lib/catalogue/lanes");
  const { evidenceGaps } = await import("@/lib/suppliers/evidence");

  (await upsertSupplier(customerId, { name: "Untouched Supplier" }));
  const gaps = (await evidenceGaps(customerId));
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].docType, "any");
  assert.match(gaps[0].detail, /unasked question, not a supplier failure/);
});

test("expiry inside the horizon warns before it becomes expired", async () => {
  const { customerId } = await operatingDb();
  const { upsertSupplier } = await import("@/lib/catalogue/lanes");
  const { upsertEvidence, evidenceGaps } = await import("@/lib/suppliers/evidence");

  const supplier = (await upsertSupplier(customerId, { name: "Soon Expiring" }));
  (await upsertEvidence({
    supplierId: supplier.id,
    docType: "rohs",
    status: "received",
    expiresAt: "2026-09-15",
  }));

  const soon = (await evidenceGaps(customerId, { now: new Date("2026-08-16T00:00:00Z"), horizonDays: 60 }));
  assert.equal(soon[0].status, "received");
  assert.equal(soon[0].severity, "medium");
  assert.match(soon[0].detail, /expires on 2026-09-15/);

  const notYet = (await evidenceGaps(customerId, {
    now: new Date("2026-08-16T00:00:00Z"),
    horizonDays: 7,
  }));
  assert.equal(notYet.length, 0, "outside the horizon it is not yet a gap");
});

test("requesting evidence records the request and does not claim to have sent it", async () => {
  const { customerId } = await operatingDb();
  const { upsertSupplier } = await import("@/lib/catalogue/lanes");
  const { requestEvidence } = await import("@/lib/suppliers/evidence");

  const supplier = (await upsertSupplier(customerId, { name: "PT Bahan Baku" }));
  const result = (await requestEvidence(supplier.id, "certificate_of_origin"));

  assert.equal(result.record.status, "requested");
  assert.ok(result.record.requestedAt);
  assert.equal(result.delivered, false, "outreach infrastructure is deferred; do not imply delivery");
  assert.match(result.draftMessage, /PT Bahan Baku/);
  assert.match(result.draftMessage, /certificate of origin/);
});

test("material keywords suggest questions and say they are only suggestions", async () => {
  const { customerId } = await operatingDb();
  const { upsertProduct } = await import("@/lib/catalogue/products");
  const { suggestedEvidence } = await import("@/lib/suppliers/evidence");

  (await upsertProduct(customerId, {
    sku: "PVC-100",
    name: "Blue tarp",
    materials: ["PVC coated polyester scrim"],
  }));

  const suggestions = (await suggestedEvidence(customerId));
  assert.ok(suggestions.length > 0);
  for (const suggestion of suggestions) {
    assert.match(suggestion.why, /not a determination that any rule applies/);
  }
});
