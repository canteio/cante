import assert from "node:assert/strict";
import test from "node:test";
import { screenUsExportControls } from "./us-export-controls";

test("screenUsExportControls blocks exports to embargoed destinations immediately", () => {
  const result = screenUsExportControls({
    productDescription: "Standard PVC Tarpaulin",
    destinationCountry: "Cuba",
  });

  assert.equal(result.licenseDetermination, "PROHIBITED_EMBARGO");
  assert.equal(result.destinationStatus, "embargoed_destination");
  assert.ok(result.warnings.some((w) => w.includes("embargo")));
});

test("screenUsExportControls clears commercial EAR99 goods to allied countries under NLR", () => {
  const result = screenUsExportControls({
    productDescription: "Commercial Vinyl Coated Industrial Fabric",
    eccn: "EAR99",
    destinationCountry: "Germany",
    endUserType: "commercial",
  });

  assert.equal(result.isControlled, false);
  assert.equal(result.classification, "EAR99");
  assert.equal(result.licenseDetermination, "NLR");
  assert.match(result.guidance, /NLR/);
});

test("screenUsExportControls detects dual-use controlled polymers to countries of concern", () => {
  const result = screenUsExportControls({
    productDescription: "High-grade Polyimide Film for Aerospace Insulation",
    destinationCountry: "China",
  });

  assert.equal(result.isControlled, true);
  assert.equal(result.classification, "1C008");
  assert.equal(result.destinationStatus, "country_of_concern");
  assert.equal(result.licenseDetermination, "LICENSE_REQUIRED");
  assert.ok(result.warnings.some((w) => w.includes("BIS export license")));
});
