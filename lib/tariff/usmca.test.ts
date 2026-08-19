import assert from "node:assert/strict";
import test from "node:test";
import {
  checkTariffShift,
  evaluateUsmcaQualification,
  generateUsmcaCertificationDocument,
} from "./usmca";

test("checkTariffShift validates CTH heading shift correctly", () => {
  const materials = [
    { description: "PVC Resin", htsusCode: "3904.10", valueUsd: 2000, originCountry: "China" },
    { description: "DOP Plasticizer", htsusCode: "2917.34", valueUsd: 800, originCountry: "Taiwan" },
  ];
  // Finished Good: PVC Sheeting (3920.43)
  // Shift from 3904 (resin) to 3920 (sheet) -> Heading 3904 != 3920, 2917 != 3920. Satisfied!
  const shift = checkTariffShift("3920.43.00", materials, "CTH");
  assert.equal(shift.satisfied, true);

  // If material is already in Heading 3920 (e.g. 3920.10 raw sheet into 3920.43 sheet)
  const failShift = checkTariffShift("3920.43.00", [{ description: "Base Sheet", htsusCode: "3920.10", valueUsd: 500, originCountry: "CN" }], "CTH");
  assert.equal(failShift.satisfied, false);
});

test("evaluateUsmcaQualification evaluates RVC and Tariff Shift", () => {
  // $10,000 finished good, $3,000 non-originating inputs -> RVC = 70%
  const result = evaluateUsmcaQualification({
    finishedProductHtsus: "3920.43.00",
    finishedProductDescription: "Flexible Vinyl Sheeting",
    producerCountry: "US",
    transactionValueUsd: 10000,
    nonOriginatingMaterials: [
      { description: "Plasticizer", htsusCode: "2917.34", valueUsd: 1500, originCountry: "DE" },
      { description: "Stabilizer", htsusCode: "3812.39", valueUsd: 1500, originCountry: "JP" },
    ],
    requiredRvcPercent: 60,
    ruleType: "tariff_shift_and_rvc",
  });

  assert.equal(result.qualifies, true);
  assert.equal(result.originCriterion, "B");
  assert.equal(result.rvcCalculated.rvcPercent, 70);
  assert.equal(result.rvcCalculated.satisfied, true);
});

test("generateUsmcaCertificationDocument formats compliant 9-element certificate", () => {
  const cert = generateUsmcaCertificationDocument({
    certifier: {
      role: "PRODUCER",
      name: "John Miller",
      title: "VP Supply Chain",
      companyName: "Acme Vinyl LLC",
      address: "100 Industrial Pkwy, Cleveland, OH 44101",
      phone: "+1-216-555-0199",
      email: "jmiller@acmevinyl.com",
      taxId: "34-1234567",
    },
    blanketPeriod: { from: "2026-01-01", to: "2026-12-31" },
    items: [
      {
        description: "PVC Tarpaulin & Protective Covers",
        htsusCode: "6306.19.00",
        originCriterion: "B",
        producerRole: "YES",
      },
    ],
  });

  assert.match(cert, /CERTIFICATION OF ORIGIN/);
  assert.match(cert, /Acme Vinyl LLC/);
  assert.match(cert, /6306.19.00/);
  assert.match(cert, /Origin Criterion: B/);
});
