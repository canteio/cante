import assert from "node:assert/strict";
import test from "node:test";
import { generateAuditDefenseDossier } from "./audit-vault";

test("generateAuditDefenseDossier produces complete Indonesian DJBC audit packet", () => {
  const dossier = generateAuditDefenseDossier({
    dossierReferenceNumber: "AUD-DJBC-2026-001",
    auditAgency: "BEA_CUKAI_INDONESIA",
    auditNoticeReference: "Surat Tugas Audit KPU Bea dan Cukai Tanjung Perak #ST-101/2026",
    company: {
      companyName: "PT MA Makmur Surabaya",
      country: "Indonesia",
      tradeIdentifiers: {
        nibOrEin: "0123456789012",
        apiOrIorNumber: "API-P 998877",
        kbliOrNaics: ["22210", "13992"],
      },
      facilityAddress: "Jl. Rungkut Industri No. 88, Surabaya, Jawa Timur",
      sideOfTrade: "import",
    },
    transactions: [
      {
        shipmentReference: "PO-2026-050",
        declarationNumber: "PIB-123456-2026",
        declarationDate: "2026-06-15",
        declaredHsCode: "3904.10.00",
        declaredDescription: "PVC Resin K-67 in Primary Forms",
        cifValue: 750000000,
        currency: "IDR",
        dutyTaxesPaid: {
          importDuty: 37500000,
          vatOrPpn: 86625000,
          withholdingOrPph: 19687500,
          total: 143812500,
        },
        commercialDocumentsAttached: ["CI #INV-500", "BL #ONE123", "COA Lot 889", "COO Form AK"],
        quotaPermitDeducted: "PI-PLASTIK-2026-001",
        classificationRationale: "GRI 1 & 6 — PVC homopolymer uncompounded under Heading 3904.",
      },
    ],
    diligenceHistory: [
      {
        checkDate: "2026-06-01",
        regulationCited: "Permendag 12/2026 (Kebijakan Impor Bahan Baku Plastik)",
        findingVerdict: "noted",
        actionState: "closed",
        actionTakenBy: "Compliance Lead",
        brokerConfirmationNote: "PPJK verified PI quota balance prior to vessel arrival.",
      },
    ],
    preparedBy: {
      name: "Budi Santoso",
      title: "Head of Customs Compliance",
      department: "Supply Chain & Logistics",
    },
  });

  assert.match(dossier, /DIREKTORAT JENDERAL BEA DAN CUKAI/);
  assert.match(dossier, /PT MA Makmur Surabaya/);
  assert.match(dossier, /PIB-123456-2026/);
  assert.match(dossier, /3904\.10\.00/);
  assert.match(dossier, /Permendag 12/);
  assert.match(dossier, /Budi Santoso/);
});
