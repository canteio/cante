import assert from "node:assert/strict";
import test from "node:test";
import {
  isHtsMatchingNotice,
  calculateNoticeExposure,
  ARCHIVED_USTR_NOTICES,
  type ProductCatalogItem,
} from "./federal-register-monitor";

test("isHtsMatchingNotice correctly matches exact and prefix HTS subheadings", () => {
  const notice = ARCHIVED_USTR_NOTICES[0]; // affected: ["3916", "8433", "8432", "8501", "8483", "8708"]

  assert.equal(isHtsMatchingNotice("3916.90.30.00", notice.affectedHtsHeadings), true);
  assert.equal(isHtsMatchingNotice("8433.11.00.50", notice.affectedHtsHeadings), true);
  assert.equal(isHtsMatchingNotice("8501104060", notice.affectedHtsHeadings), true);
  assert.equal(isHtsMatchingNotice("9001.10.00.00", notice.affectedHtsHeadings), false);
});

test("calculateNoticeExposure computes dollar impact and affected product counts", () => {
  const notice = ARCHIVED_USTR_NOTICES[0];
  const catalog: ProductCatalogItem[] = [
    { sku: "SKU-CUTTER-01", name: "Rotary Blade Subassembly", hts: "8433.11.00.00", annualValueUsd: 100000, supplier: "Precision Parts Ltd", origin: "CN" },
    { sku: "SKU-MOTOR-02", name: "Electric Drive Motor", hts: "8501.10.40.60", annualValueUsd: 200000, supplier: "Apex Drives", origin: "CN" },
    { sku: "SKU-PLASTIC-03", name: "Molded Extrusion", hts: "3916.90.30.00", annualValueUsd: 50000, supplier: "Apex Drives", origin: "VN" },
    { sku: "SKU-OPTIC-04", name: "Glass Lens", hts: "9001.10.00.00", annualValueUsd: 30000, supplier: "ClearView Optics", origin: "DE" },
  ];

  const alert = calculateNoticeExposure(notice, catalog);

  assert.equal(alert.affectedProductCount, 3); // SKU-CUTTER-01, SKU-MOTOR-02, SKU-PLASTIC-03
  assert.equal(alert.affectedSupplierCount, 2); // Precision Parts Ltd, Apex Drives
  // 25% of ($100,000 + $200,000 + $50,000) = 25% of $350,000 = $87,500
  assert.equal(alert.totalAnnualExposureUsd, 87500);
  assert.equal(alert.effectiveDate, "2026-10-15");
  assert.ok(alert.summary.includes("Section 301"));
});

test("calculateNoticeExposure works on CBP CSMS bulletins", async () => {
  const { ARCHIVED_CBP_CSMS_BULLETINS } = await import("./federal-register-monitor");
  const bulletin = ARCHIVED_CBP_CSMS_BULLETINS[0];
  const catalog: ProductCatalogItem[] = [
    { sku: "DRIVE-01", name: "Drive Assembly", hts: "8501.10.40.60", annualValueUsd: 400000, supplier: "Shenzhen Motors", origin: "CN" },
    { sku: "OTHER-02", name: "Neutral Item", hts: "9001.10.00.00", annualValueUsd: 100000, supplier: "German Optics", origin: "DE" },
  ];
  const alert = calculateNoticeExposure(bulletin, catalog);
  assert.equal(alert.affectedProductCount, 1);
  assert.equal(alert.totalAnnualExposureUsd, 100000); // 25% of 400,000 = 100,000
  assert.match(bulletin.documentNumber, /CSMS #65441222/);
  assert.equal(bulletin.agency, "U.S. Customs and Border Protection");
});
