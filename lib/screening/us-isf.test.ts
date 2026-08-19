import assert from "node:assert/strict";
import test from "node:test";
import { auditIsfCompliance } from "./us-isf";

test("auditIsfCompliance marks non-ocean shipments as exempt", () => {
  const result = auditIsfCompliance({
    shipmentId: "AIR-1234",
    transportMode: "air",
    importerElements: {},
  });

  assert.equal(result.isApplicable, false);
  assert.equal(result.filingStatus, "exempt_non_ocean");
  assert.equal(result.penaltyExposureUsd, 0);
});

test("auditIsfCompliance identifies missing ISF importer elements and calculates deadline", () => {
  const now = new Date("2026-08-19T12:00:00Z");
  const result = auditIsfCompliance(
    {
      shipmentId: "OCN-9988",
      transportMode: "ocean",
      estimatedVesselLadingAt: "2026-08-21T12:00:00Z", // 48h from now, deadline is 24h before (24h left)
      importerElements: {
        manufacturer: "Suzhou Chemical Co.",
        seller: "Suzhou Chemical Co.",
        buyer: "US Plastics Corp",
        importerOfRecordNumber: "12-3456789",
        consigneeNumber: "12-3456789",
        countryOfOrigin: "China",
        htsusCode: "3904.10.00",
        // missing: shipToParty, stuffingLocation, consolidator
      },
    },
    now,
  );

  assert.equal(result.isApplicable, true);
  assert.equal(result.isCompliant, false);
  assert.equal(result.hoursUntilLadingDeadline, 24);
  assert.equal(result.missingElements.length, 3); // shipToParty, stuffingLocation, consolidator
  assert.ok(result.actionChecklist.some((a) => a.includes("Ship-to Party")));
});

test("auditIsfCompliance flags late filings with $5,000 CBP liquidated damages penalty", () => {
  const now = new Date("2026-08-19T12:00:00Z");
  const result = auditIsfCompliance(
    {
      shipmentId: "OCN-LATE",
      transportMode: "ocean",
      estimatedVesselLadingAt: "2026-08-19T18:00:00Z", // lading is 6h away, deadline was 18h ago
      isfFiledAt: "2026-08-19T06:00:00Z", // filed 12h before lading (late by 12h)
      importerElements: {
        manufacturer: "A",
        seller: "B",
        buyer: "C",
        shipToParty: "D",
        stuffingLocation: "E",
        consolidator: "F",
        importerOfRecordNumber: "G",
        consigneeNumber: "H",
        countryOfOrigin: "VN",
        htsusCode: "3920.43.00",
      },
    },
    now,
  );

  assert.equal(result.filingStatus, "filed_late");
  assert.equal(result.penaltyExposureUsd, 5000);
  assert.ok(result.warnings.some((w) => w.includes("$5,000")));
});
