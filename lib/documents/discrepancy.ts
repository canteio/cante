/**
 * Document Cross-Check & Discrepancy Engine
 *
 * Cross-references data fields across core international trade document sets:
 * 1. Commercial Invoice (CI)
 * 2. Packing List (PL)
 * 3. Bill of Lading (BL / Sea Waybill / Air Waybill)
 * 4. Certificate of Analysis (COA / Technical Data Sheet)
 * 5. Certificate of Origin (COO / Form E / Form AK / USMCA)
 *
 * Flags discrepancies before customs declaration submission to prevent port holds,
 * red-lane examinations, and customs penalties.
 */

export interface CommercialInvoiceData {
  invoiceNumber: string;
  invoiceDate: string;
  sellerName: string;
  buyerName: string;
  currency: string;
  incoterm: "FOB" | "CIF" | "CFR" | "EXW" | "DDP" | "DAP";
  totalValue: number;
  lineItems: Array<{
    itemDescription: string;
    htsusCode: string;
    quantity: number;
    unitPrice: number;
    totalAmount: number;
  }>;
}

export interface PackingListData {
  packingListNumber?: string;
  invoiceReferenceNumber?: string;
  totalPackages: number;
  totalGrossWeightKg: number;
  totalNetWeightKg: number;
  containerNumbers: string[];
}

export interface BillOfLadingData {
  blNumber: string;
  shipperName: string;
  consigneeName: string;
  notifyParty?: string;
  portOfLoading: string;
  portOfDischarge: string;
  vesselName?: string;
  voyageNumber?: string;
  containerNumbers: string[];
  declaredGrossWeightKg?: number;
  freightPayableTerm?: "PREPAID" | "COLLECT";
  goodsDescription?: string;
}

export interface CertificateOfAnalysisData {
  coaNumber?: string;
  productName: string;
  batchNumber: string;
  productionDate?: string;
  chemicalParameters: Array<{
    parameterName: string;
    casNumber?: string;
    measuredValue: string | number;
    specificationLimit?: string;
    isPass: boolean;
  }>;
  requiresNonB3OrTscaStatement?: boolean;
  nonHazardousConfirmed?: boolean;
}

export interface CertificateOfOriginData {
  coNumber: string;
  formType: "FORM_E" | "FORM_AK" | "FORM_D" | "USMCA" | "GENERAL_COO";
  issuingAuthority?: string;
  countryOfOrigin: string;
  invoiceReferenceNumber: string;
  declaredHtsCode: string;
  originCriterion: string;
}

export interface DocumentSet {
  shipmentReference: string;
  commercialInvoice?: CommercialInvoiceData;
  packingList?: PackingListData;
  billOfLading?: BillOfLadingData;
  certificateOfAnalysis?: CertificateOfAnalysisData;
  certificateOfOrigin?: CertificateOfOriginData;
}

export interface DiscrepancyFlag {
  category: "HTS_MISMATCH" | "WEIGHT_MISMATCH" | "INCOTERM_FREIGHT_MISMATCH" | "PARTY_MISMATCH" | "CHEMICAL_COMPLIANCE_GAP" | "CONTAINER_MISMATCH";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "WARNING";
  title: string;
  details: string;
  documentsInvolved: string[];
  recommendedResolution: string;
}

export interface DiscrepancyAuditResult {
  hasDiscrepancies: boolean;
  criticalDiscrepancyCount: number;
  flags: DiscrepancyFlag[];
  clearanceReadinessScore: number; // 0 - 100
  summary: string;
}

function cleanHts(hts: string): string {
  return hts.replace(/[^0-9]/g, "").slice(0, 6);
}

/**
 * Cross-examine a full set of shipping documents for consistency and regulatory readiness.
 */
export function auditDocumentDiscrepancies(docs: DocumentSet): DiscrepancyAuditResult {
  const flags: DiscrepancyFlag[] = [];
  const ci = docs.commercialInvoice;
  const pl = docs.packingList;
  const bl = docs.billOfLading;
  const coa = docs.certificateOfAnalysis;
  const coo = docs.certificateOfOrigin;

  // 1. HTS Code Discrepancies (CI vs COO)
  if (ci && coo) {
    const ciHtsCodes = ci.lineItems.map((li) => cleanHts(li.htsusCode));
    const cooHts = cleanHts(coo.declaredHtsCode);

    if (ciHtsCodes.length > 0 && !ciHtsCodes.some((code) => code.startsWith(cooHts) || cooHts.startsWith(code))) {
      flags.push({
        category: "HTS_MISMATCH",
        severity: "CRITICAL",
        title: "HS Code Mismatch between Invoice and Certificate of Origin",
        details: `Commercial Invoice declares HS ${ci.lineItems[0].htsusCode}, but Certificate of Origin (${coo.formType}) specifies HS ${coo.declaredHtsCode}.`,
        documentsInvolved: ["Commercial Invoice", "Certificate of Origin"],
        recommendedResolution: "Request an amended Certificate of Origin matching the declared invoice tariff line before submitting customs clearance to prevent preferential tariff rejection.",
      });
    }
  }

  // 2. Weight Discrepancies (Packing List vs Bill of Lading & Net > Gross check)
  if (pl) {
    if (pl.totalNetWeightKg > pl.totalGrossWeightKg) {
      flags.push({
        category: "WEIGHT_MISMATCH",
        severity: "CRITICAL",
        title: "Net Weight Exceeds Gross Weight on Packing List",
        details: `Total Net Weight (${pl.totalNetWeightKg} kg) cannot be greater than Total Gross Weight (${pl.totalGrossWeightKg} kg).`,
        documentsInvolved: ["Packing List"],
        recommendedResolution: "Correct weight calculations on the Packing List before submitting PIB / Entry Summary.",
      });
    }

    if (bl && bl.declaredGrossWeightKg !== undefined) {
      const diffKg = Math.abs(pl.totalGrossWeightKg - bl.declaredGrossWeightKg);
      const tolerancePercent = (diffKg / pl.totalGrossWeightKg) * 100;

      if (tolerancePercent > 1.0) {
        flags.push({
          category: "WEIGHT_MISMATCH",
          severity: "HIGH",
          title: "Gross Weight Discrepancy between Packing List and Bill of Lading",
          details: `Packing List gross weight is ${pl.totalGrossWeightKg} kg, while Bill of Lading shows ${bl.declaredGrossWeightKg} kg (variance: ${tolerancePercent.toFixed(1)}%).`,
          documentsInvolved: ["Packing List", "Bill of Lading"],
          recommendedResolution: "Align weight on Bill of Lading with certified VGM (Verified Gross Mass) and Packing List.",
        });
      }
    }
  }

  // 3. Incoterm vs Freight Payment Term Discrepancy
  if (ci && bl) {
    const isPrepaidIncoterm = ci.incoterm === "CIF" || ci.incoterm === "CFR" || ci.incoterm === "DDP" || ci.incoterm === "DAP";
    if (isPrepaidIncoterm && bl.freightPayableTerm === "COLLECT") {
      flags.push({
        category: "INCOTERM_FREIGHT_MISMATCH",
        severity: "HIGH",
        title: "Incoterm Freight Conflict (Prepaid Incoterm vs Freight Collect B/L)",
        details: `Commercial Invoice specifies ${ci.incoterm} (freight included by seller), but Bill of Lading indicates Freight COLLECT.`,
        documentsInvolved: ["Commercial Invoice", "Bill of Lading"],
        recommendedResolution: "Verify freight payment terms with forwarder to avoid double freight billing or customs valuation disputes.",
      });
    }
  }

  // 4. Container Number Mismatch (PL vs BL)
  if (pl && bl && pl.containerNumbers.length > 0 && bl.containerNumbers.length > 0) {
    const plContainers = new Set(pl.containerNumbers.map((c) => c.replace(/[^A-Z0-9]/gi, "").toUpperCase()));
    const blContainers = new Set(bl.containerNumbers.map((c) => c.replace(/[^A-Z0-9]/gi, "").toUpperCase()));

    for (const c of plContainers) {
      if (!blContainers.has(c)) {
        flags.push({
          category: "CONTAINER_MISMATCH",
          severity: "CRITICAL",
          title: `Container Number ${c} Not Found on Bill of Lading`,
          details: `Container ${c} listed on Packing List is missing from the Bill of Lading.`,
          documentsInvolved: ["Packing List", "Bill of Lading"],
          recommendedResolution: "Ensure all container seals and numbers match exactly between PL, BL, and customs manifest.",
        });
      }
    }
  }

  // 5. Chemical Compliance & CAS Number Gaps (COA)
  if (coa) {
    const missingCas = coa.chemicalParameters.filter((p) => !p.casNumber || !p.casNumber.trim());
    if (missingCas.length > 0) {
      flags.push({
        category: "CHEMICAL_COMPLIANCE_GAP",
        severity: "MEDIUM",
        title: "Missing CAS Numbers on Certificate of Analysis",
        details: `${missingCas.length} chemical parameter(s) (${missingCas.map((p) => p.parameterName).join(", ")}) lack specific CAS registry numbers.`,
        documentsInvolved: ["Certificate of Analysis"],
        recommendedResolution: "Request supplier include CAS numbers on COA for KLHK non-B3 notification and EPA TSCA positive certification.",
      });
    }

    const failedParams = coa.chemicalParameters.filter((p) => !p.isPass);
    if (failedParams.length > 0) {
      flags.push({
        category: "CHEMICAL_COMPLIANCE_GAP",
        severity: "CRITICAL",
        title: "Failed Quality / Specification Parameters on COA",
        details: `${failedParams.length} parameter(s) failed specification limits: ${failedParams.map((p) => p.parameterName).join(", ")}.`,
        documentsInvolved: ["Certificate of Analysis"],
        recommendedResolution: "Do not approve shipment loading until supplier provides batch re-test certificate meeting contract specifications.",
      });
    }
  }

  // 6. Invoice Reference Cross-Check (COO vs CI)
  if (ci && coo && coo.invoiceReferenceNumber) {
    if (coo.invoiceReferenceNumber.trim().toUpperCase() !== ci.invoiceNumber.trim().toUpperCase()) {
      flags.push({
        category: "PARTY_MISMATCH",
        severity: "HIGH",
        title: "Invoice Number Mismatch on Certificate of Origin",
        details: `Certificate of Origin references Invoice #${coo.invoiceReferenceNumber}, but attached Commercial Invoice is #${ci.invoiceNumber}.`,
        documentsInvolved: ["Commercial Invoice", "Certificate of Origin"],
        recommendedResolution: "Align invoice reference numbers to prevent customs rejection of preferential tariff treatment.",
      });
    }
  }

  const criticalDiscrepancyCount = flags.filter((f) => f.severity === "CRITICAL").length;
  const highCount = flags.filter((f) => f.severity === "HIGH").length;
  const mediumCount = flags.filter((f) => f.severity === "MEDIUM").length;

  let deduction = criticalDiscrepancyCount * 35 + highCount * 15 + mediumCount * 5;
  const clearanceReadinessScore = Math.max(0, 100 - deduction);

  const summary =
    flags.length === 0
      ? "All shipping documents are consistent and ready for customs entry declaration."
      : `Identified ${flags.length} discrepancy(ies) (${criticalDiscrepancyCount} critical, ${highCount} high). Clearance readiness score: ${clearanceReadinessScore}/100.`;

  return {
    hasDiscrepancies: flags.length > 0,
    criticalDiscrepancyCount,
    flags,
    clearanceReadinessScore,
    summary,
  };
}
