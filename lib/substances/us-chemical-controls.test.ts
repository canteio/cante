import assert from "node:assert/strict";
import test from "node:test";
import { screenUsChemicalControls } from "./us-chemical-controls";

test("screenUsChemicalControls detects prohibited TSCA Section 6 PBT flame retardants", () => {
  const result = screenUsChemicalControls({
    productName: "Heavy Duty Flame Retardant Tarpaulin",
    productCategory: "plastics_vinyl",
    substances: [
      { chemicalName: "Decabromodiphenyl ether", casNumber: "1163-19-5", concentrationPercent: 5 },
      { chemicalName: "Polyvinyl Chloride", casNumber: "9002-86-2", concentrationPercent: 60 },
    ],
  });

  assert.equal(result.hasFlags, true);
  assert.equal(result.tscaPbtProhibited, true);
  assert.ok(result.flags.some((f) => f.framework === "EPA_TSCA_PBT" && f.severity === "PROHIBITED"));
});

test("screenUsChemicalControls flags EPA TSCA Section 8(a)(7) PFAS coatings", () => {
  const result = screenUsChemicalControls({
    productName: "Waterproof Coated Membrane",
    productCategory: "textiles_coated",
    substances: [
      { chemicalName: "Fluoropolymer Water Repellent Treatment", intendedFunction: "water repellent" },
      { chemicalName: "Polyester woven fabric", concentrationPercent: 80 },
    ],
  });

  assert.equal(result.tscaPfasReportable, true);
  assert.ok(result.flags.some((f) => f.framework === "EPA_TSCA_PFAS"));
});

test("screenUsChemicalControls formats compliant California Prop 65 warning label for DINP/DEHP plasticizers", () => {
  const result = screenUsChemicalControls({
    productName: "Flexible Vinyl Sheeting",
    productCategory: "plastics_vinyl",
    distributedInCalifornia: true,
    substances: [
      { chemicalName: "Diisononyl phthalate (DINP)", casNumber: "28553-12-0", intendedFunction: "plasticizer" },
      { chemicalName: "Antimony Trioxide", casNumber: "1309-64-4", intendedFunction: "flame retardant synergist" },
    ],
  });

  assert.equal(result.prop65WarningRequired, true);
  assert.ok(result.prop65WarningLabelText);
  assert.match(result.prop65WarningLabelText, /WARNING: This product can expose you to chemicals/);
  assert.match(result.prop65WarningLabelText, /DINP/);
  assert.match(result.prop65WarningLabelText, /Antimony Trioxide/);
  assert.match(result.prop65WarningLabelText, /www.P65Warnings.ca.gov/);
});
