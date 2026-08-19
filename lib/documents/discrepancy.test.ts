import assert from "node:assert/strict";
import test from "node:test";
import { auditDocumentDiscrepancies } from "./discrepancy";

test("auditDocumentDiscrepancies returns clean score for perfectly matching documents", () => {
  const result = auditDocumentDiscrepancies({
    shipmentReference: "SHP-2026-001",
    commercialInvoice: {
      invoiceNumber: "INV-9988",
      invoiceDate: "2026-08-10",
      sellerName: "LG Chem Ltd",
      buyerName: "MA Plastics Surabaya",
      currency: "USD",
      incoterm: "CIF",
      totalValue: 50000,
      lineItems: [
        { itemDescription: "PVC Resin K-67", htsusCode: "3904.10.00", quantity: 50, unitPrice: 1000, totalAmount: 50000 },
      ],
    },
    packingList: {
      invoiceReferenceNumber: "INV-9988",
      totalPackages: 2000,
      totalGrossWeightKg: 50500,
      totalNetWeightKg: 50000,
      containerNumbers: ["TGHU1234567", "MSKU7654321"],
    },
    billOfLading: {
      blNumber: "ONE202608101",
      shipperName: "LG Chem Ltd",
      consigneeName: "MA Plastics Surabaya",
      portOfLoading: "Busan",
      portOfDischarge: "Tanjung Perak, Surabaya",
      containerNumbers: ["TGHU1234567", "MSKU7654321"],
      declaredGrossWeightKg: 50500,
      freightPayableTerm: "PREPAID",
    },
    certificateOfOrigin: {
      coNumber: "AK2026-8877",
      formType: "FORM_AK",
      countryOfOrigin: "KR",
      invoiceReferenceNumber: "INV-9988",
      declaredHtsCode: "3904.10",
      originCriterion: "WO",
    },
    certificateOfAnalysis: {
      productName: "PVC Resin K-67",
      batchNumber: "LOT-2026-08",
      chemicalParameters: [
        { parameterName: "Polyvinyl chloride", casNumber: "9002-86-2", measuredValue: "99.8%", isPass: true },
      ],
    },
  });

  assert.equal(result.hasDiscrepancies, false);
  assert.equal(result.criticalDiscrepancyCount, 0);
  assert.equal(result.clearanceReadinessScore, 100);
});

test("auditDocumentDiscrepancies flags weight, HTS, and CAS discrepancies", () => {
  const result = auditDocumentDiscrepancies({
    shipmentReference: "SHP-DISC-002",
    commercialInvoice: {
      invoiceNumber: "INV-100",
      invoiceDate: "2026-08-10",
      sellerName: "Vendor A",
      buyerName: "Buyer B",
      currency: "USD",
      incoterm: "CIF",
      totalValue: 20000,
      lineItems: [
        { itemDescription: "Plasticizer DOP", htsusCode: "2917.34.00", quantity: 20, unitPrice: 1000, totalAmount: 20000 },
      ],
    },
    packingList: {
      totalPackages: 100,
      totalGrossWeightKg: 20000,
      totalNetWeightKg: 22000, // Net > Gross!
      containerNumbers: ["CONT111", "CONT222"],
    },
    billOfLading: {
      blNumber: "BL-100",
      shipperName: "Vendor A",
      consigneeName: "Buyer B",
      portOfLoading: "Shanghai",
      portOfDischarge: "Tanjung Priok",
      containerNumbers: ["CONT111"], // CONT222 is missing!
      declaredGrossWeightKg: 25000, // 20k vs 25k!
      freightPayableTerm: "COLLECT", // CIF vs Collect!
    },
    certificateOfOrigin: {
      coNumber: "FORM-E-01",
      formType: "FORM_E",
      countryOfOrigin: "CN",
      invoiceReferenceNumber: "INV-999", // Invoice mismatch!
      declaredHtsCode: "3812.39", // 2917 vs 3812 HTS mismatch!
      originCriterion: "RVC",
    },
    certificateOfAnalysis: {
      productName: "DOP Plasticizer",
      batchNumber: "B1",
      chemicalParameters: [
        { parameterName: "Dioctyl phthalate", measuredValue: "99.5%", isPass: true }, // missing CAS number!
      ],
    },
  });

  assert.equal(result.hasDiscrepancies, true);
  assert.ok(result.flags.some((f) => f.category === "WEIGHT_MISMATCH"));
  assert.ok(result.flags.some((f) => f.category === "HTS_MISMATCH"));
  assert.ok(result.flags.some((f) => f.category === "INCOTERM_FREIGHT_MISMATCH"));
  assert.ok(result.flags.some((f) => f.category === "CONTAINER_MISMATCH"));
  assert.ok(result.flags.some((f) => f.category === "CHEMICAL_COMPLIANCE_GAP"));
  assert.ok(result.clearanceReadinessScore < 50);
});
