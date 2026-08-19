import assert from "node:assert/strict";
import test from "node:test";
import { generateCbpDefenseDraft } from "./us-cbp-response";

test("generateCbpDefenseDraft produces formal CBP Form 28 legal response letter", () => {
  const draft = generateCbpDefenseDraft({
    formType: "CBP_FORM_28",
    cbpPort: "Port of Long Beach (2704)",
    importSpecialistName: "Officer J. Smith",
    inquiryDate: "2026-08-01",
    responseDeadlineDate: "2026-08-31",
    entryNumber: "987-1234567-8",
    entryDate: "2026-07-15",
    importerOfRecord: {
      companyName: "Acme Vinyl Imports Inc.",
      importerNumber: "12-3456789",
      address: "500 Ocean Blvd, Long Beach, CA 90802",
    },
    disputedItem: {
      productDescription: "PVC Coated Polyester Tarpaulin Fabric",
      declaredHtsus: "5903.10.20",
      proposedHtsusByCbp: "3921.90.19",
      reasonForInquiry: "Classification dispute regarding coating thickness and essential character",
    },
    defenseArguments: {
      essentialCharacterDescription: "the woven polyester substrate providing primary tensile strength",
      applicableGris: ["GRI 1", "GRI 3(b)"],
      referencedCrossRulings: ["NY N304567", "HQ H291823"],
      materialBreakdown: "65% polyester woven fabric, 35% compact PVC coating",
    },
    attachedEvidence: [
      "Commercial Invoice & Packing List",
      "Independent Textile Lab Test Report (ASTM D751)",
      "Cross-sectional Microscopic Coating Measurement",
    ],
  });

  assert.match(draft, /CBP Form 28/);
  assert.match(draft, /Request for Information/);
  assert.match(draft, /Port of Long Beach/);
  assert.match(draft, /987-1234567-8/);
  assert.match(draft, /5903\.10\.20/);
  assert.match(draft, /GRI 3\(b\)/);
  assert.match(draft, /NY N304567/);
  assert.match(draft, /ASTM D751/);
});
