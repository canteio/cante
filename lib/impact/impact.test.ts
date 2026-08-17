import assert from "node:assert/strict";
import test, { before } from "node:test";
import { operatingDb, seedFinding } from "@/lib/test-support/operating-db";

/**
 * `lib/db/client.ts` reads CANTE_DB_PATH once, at import time. The first
 * dynamic import inside any test binds the connection permanently, so the
 * temp database has to exist and the variable has to be set before a single
 * test body runs — otherwise everything silently talks to the real cante.db.
 */
before(async () => {
  await operatingDb();
});

const finding = (over: Partial<{ title: string; summaryEn: string | null; reasoning: string | null; regulationRef: string | null }> = {}) => ({
  title: over.title ?? "Permendag 12/2026 on export of tarpaulins",
  summaryEn: over.summaryEn ?? null,
  reasoning: over.reasoning ?? null,
  regulationRef: over.regulationRef ?? null,
});

test("codes are read out of finding text only at 6 digits or more", async () => {
  const { codesMentionedIn } = await import("@/lib/impact/assess");
  assert.deepEqual(
    codesMentionedIn(finding({ title: "Rule covering 6306.12.00 and 3921.90" })),
    ["63061200", "392190".padEnd(6, "")].filter((c) => c.length >= 6),
  );
  // A bare year must not be read as a tariff code.
  assert.deepEqual(codesMentionedIn(finding({ title: "Permendag 12 Tahun 2026" })), []);
});

test("exposure is null, never zero, when an input is missing", async () => {
  const { customerId, dbPath } = await operatingDb();
  const { upsertProduct } = await import("@/lib/catalogue/products");
  const { recordClassification } = await import("@/lib/catalogue/classifications");
  const { upsertLane } = await import("@/lib/catalogue/lanes");
  const { assessImpact } = await import("@/lib/impact/assess");

  const { product } = upsertProduct(customerId, { sku: "PVC-100", name: "Blue tarp" });
  recordClassification({
    productId: product.id,
    system: "hs",
    code: "6306.12.00",
    tier: "document",
    basis: "PEB",
  });
  upsertLane(customerId, {
    originCountry: "Indonesia",
    destinationCountry: "Netherlands",
    productId: product.id,
    shipmentFrequency: "monthly",
    // Deliberately no annualValue.
  });

  seedFinding(dbPath, customerId, { id: "f-1", title: "Duty change for 6306.12" });
  const { db } = await import("@/lib/db/client");
  const { findings } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const row = db.select().from(findings).where(eq(findings.id, "f-1")).get();
  assert.ok(row);

  const drafts = assessImpact({
    finding: row,
    customerId,
    effectiveOn: "2026-09-01",
    duty: { before: 0.0, after: 0.05 },
  });

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].estimatedAnnualExposure, null, "must not report 0 for unknown");
  assert.equal(drafts[0].estimatedMonthlyExposure, null);
  assert.match(drafts[0].basis.join(" "), /Left unknown rather than reported as zero/);
});

test("exposure is calculated and the arithmetic is stated in the basis", async () => {
  const { customerId, dbPath } = await operatingDb();
  const { upsertProduct } = await import("@/lib/catalogue/products");
  const { recordClassification } = await import("@/lib/catalogue/classifications");
  const { upsertLane } = await import("@/lib/catalogue/lanes");
  const { assessImpact } = await import("@/lib/impact/assess");

  const { product } = upsertProduct(customerId, { sku: "PVC-100", name: "Blue tarp" });
  recordClassification({
    productId: product.id,
    system: "hs",
    code: "6306.12.00",
    tier: "document",
    basis: "PEB",
  });
  upsertLane(customerId, {
    originCountry: "Indonesia",
    destinationCountry: "Netherlands",
    productId: product.id,
    shipmentFrequency: "monthly",
    annualValue: 400_000,
    currency: "USD",
    nextShipmentAt: "2026-09-10",
  });

  // Exact code, so this exercises the strongest match path. A 6-digit rule
  // against an 8-digit catalogue code is a prefix match and is capped lower —
  // covered separately below.
  seedFinding(dbPath, customerId, { id: "f-2", title: "Duty change for 6306.12.00" });
  const { db } = await import("@/lib/db/client");
  const { findings } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const row = db.select().from(findings).where(eq(findings.id, "f-2")).get();
  assert.ok(row);

  const drafts = assessImpact({
    finding: row,
    customerId,
    effectiveOn: "2026-09-01",
    duty: { before: 0.0, after: 0.05 },
    now: new Date("2026-08-16T00:00:00Z"),
  });

  assert.equal(drafts[0].estimatedAnnualExposure, 20_000);
  assert.equal(drafts[0].estimatedMonthlyExposure, 1_666.67);
  assert.match(drafts[0].basis.join(" "), /5\.00% − 0\.00%/);
  assert.equal(drafts[0].nextAffectedShipmentAt, "2026-09-10");
  assert.equal(drafts[0].delayRisk, "medium", "25 days out");
  assert.equal(drafts[0].confidence, "estimated");
});

test("a lead-tier code caps confidence at indicative and says so", async () => {
  const { customerId, dbPath } = await operatingDb();
  const { upsertProduct } = await import("@/lib/catalogue/products");
  const { recordClassification } = await import("@/lib/catalogue/classifications");
  const { upsertLane } = await import("@/lib/catalogue/lanes");
  const { assessImpact } = await import("@/lib/impact/assess");

  const { product } = upsertProduct(customerId, { sku: "PVC-100", name: "Blue tarp" });
  recordClassification({
    productId: product.id,
    system: "hs",
    code: "6306.12.00",
    tier: "lead",
    basis: "CSV",
  });
  upsertLane(customerId, {
    originCountry: "Indonesia",
    destinationCountry: "Netherlands",
    productId: product.id,
    annualValue: 400_000,
  });

  seedFinding(dbPath, customerId, { id: "f-3", title: "Duty change for 6306.12" });
  const { db } = await import("@/lib/db/client");
  const { findings } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const row = db.select().from(findings).where(eq(findings.id, "f-3")).get();
  assert.ok(row);

  const drafts = assessImpact({
    finding: row,
    customerId,
    duty: { before: 0.0, after: 0.05 },
  });
  assert.equal(drafts[0].confidence, "indicative");
  assert.match(drafts[0].basis.join(" "), /lead tier, not document-verified/);
});

test("an empty catalogue is a coverage gap, not a finding of no impact", async () => {
  const { customerId, dbPath } = await operatingDb();
  const { assessImpact } = await import("@/lib/impact/assess");
  seedFinding(dbPath, customerId, { id: "f-4", title: "Duty change for 6306.12" });
  const { db } = await import("@/lib/db/client");
  const { findings } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const row = db.select().from(findings).where(eq(findings.id, "f-4")).get();
  assert.ok(row);

  const drafts = assessImpact({ finding: row, customerId });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].matchKind, "catalogue_wide");
  assert.match(drafts[0].matchReason, /coverage gap, not a finding of no impact/);
});

test("a 6-digit rule matching an 8-digit catalogue code is labelled a prefix match", async () => {
  const { customerId, dbPath } = await operatingDb();
  const { upsertProduct } = await import("@/lib/catalogue/products");
  const { recordClassification } = await import("@/lib/catalogue/classifications");
  const { assessImpact } = await import("@/lib/impact/assess");

  const { product } = upsertProduct(customerId, { sku: "PVC-100", name: "Blue tarp" });
  recordClassification({
    productId: product.id,
    system: "hs",
    code: "6306.12.90",
    tier: "document",
    basis: "PEB",
  });

  seedFinding(dbPath, customerId, { id: "f-5", title: "Measure on 6306.12" });
  const { db } = await import("@/lib/db/client");
  const { findings } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const row = db.select().from(findings).where(eq(findings.id, "f-5")).get();
  assert.ok(row);

  const drafts = assessImpact({ finding: row, customerId });
  assert.equal(drafts[0].matchKind, "code_prefix");
  assert.match(drafts[0].matchReason, /confirm at the full code before acting/);
});
