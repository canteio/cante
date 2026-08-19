/**
 * USMCA (United States-Mexico-Canada Agreement) Rules of Origin Engine
 *
 * Implements:
 * 1. Tariff Shift (Change in Tariff Classification / CTC):
 *    - CC: Change in Chapter (2-digit)
 *    - CTH: Change in Tariff Heading (4-digit)
 *    - CTSH: Change in Tariff Subheading (6-digit)
 * 2. Regional Value Content (RVC):
 *    - Transaction Value Method: RVC = ((TV - VNM) / TV) * 100
 *    - Net Cost Method: RVC = ((NC - VNM) / NC) * 100
 * 3. USMCA 9-Element Origin Certification Builder.
 */

export interface NonOriginatingMaterial {
  description: string;
  htsusCode: string;
  valueUsd: number;
  originCountry: string;
}

export interface UsmcaQualificationInput {
  finishedProductHtsus: string;
  finishedProductDescription: string;
  producerCountry: "US" | "MX" | "CA";
  transactionValueUsd?: number;
  netCostUsd?: number;
  nonOriginatingMaterials: NonOriginatingMaterial[];
  requiredRvcPercent?: number; // e.g. 60% TV or 50% NC
  ruleType: "tariff_shift_only" | "rvc_only" | "tariff_shift_and_rvc" | "tariff_shift_or_rvc";
}

export interface UsmcaQualificationResult {
  qualifies: boolean;
  originCriterion: "A" | "B" | "C" | "D" | "NONE";
  tariffShiftSatisfied: boolean;
  tariffShiftDetails: string[];
  rvcCalculated: {
    method: "transaction_value" | "net_cost" | "not_calculated";
    rvcPercent: number | null;
    requiredPercent: number | null;
    satisfied: boolean;
  };
  reason: string;
}

export interface UsmcaCertifierDetails {
  role: "EXPORTER" | "PRODUCER" | "IMPORTER";
  name: string;
  title: string;
  companyName: string;
  address: string;
  phone: string;
  email: string;
  taxId: string;
}

export interface UsmcaCertificateInput {
  certifier: UsmcaCertifierDetails;
  exporter?: UsmcaCertifierDetails;
  producer?: UsmcaCertifierDetails;
  importer?: UsmcaCertifierDetails;
  blanketPeriod: { from: string; to: string };
  items: Array<{
    description: string;
    htsusCode: string;
    originCriterion: "A" | "B" | "C" | "D";
    producerRole: "YES" | "NO (1)" | "NO (2)" | "NO (3)";
  }>;
}

function cleanHts(hts: string): string {
  return hts.replace(/[^0-9]/g, "");
}

/**
 * Validate tariff shift for non-originating materials against finished good.
 */
export function checkTariffShift(
  finishedHts: string,
  materials: NonOriginatingMaterial[],
  shiftRequired: "CC" | "CTH" | "CTSH" = "CTH",
): { satisfied: boolean; details: string[] } {
  const fClean = cleanHts(finishedHts);
  const details: string[] = [];
  let satisfied = true;

  for (const mat of materials) {
    const mClean = cleanHts(mat.htsusCode);
    let shifted = false;

    if (shiftRequired === "CC") {
      // Must change 2-digit chapter
      shifted = fClean.slice(0, 2) !== mClean.slice(0, 2);
    } else if (shiftRequired === "CTH") {
      // Must change 4-digit heading
      shifted = fClean.slice(0, 4) !== mClean.slice(0, 4);
    } else if (shiftRequired === "CTSH") {
      // Must change 6-digit subheading
      shifted = fClean.slice(0, 6) !== mClean.slice(0, 6);
    }

    if (!shifted) {
      satisfied = false;
      details.push(`FAILED ${shiftRequired} shift: Material "${mat.description}" (HTS ${mat.htsusCode}) shares prefix with finished good (HTS ${finishedHts}).`);
    } else {
      details.push(`PASSED ${shiftRequired} shift: Material "${mat.description}" (HTS ${mat.htsusCode}) -> Finished (HTS ${finishedHts}).`);
    }
  }

  return { satisfied, details };
}

/**
 * Evaluate whether an article qualifies for USMCA preferential tariff treatment.
 */
export function evaluateUsmcaQualification(input: UsmcaQualificationInput): UsmcaQualificationResult {
  const totalVnm = input.nonOriginatingMaterials.reduce((acc, m) => acc + m.valueUsd, 0);

  // If no non-originating materials, it is wholly obtained (Criterion A)
  if (input.nonOriginatingMaterials.length === 0) {
    return {
      qualifies: true,
      originCriterion: "A",
      tariffShiftSatisfied: true,
      tariffShiftDetails: ["Wholly obtained or produced entirely in US/MX/CA without non-originating inputs."],
      rvcCalculated: { method: "not_calculated", rvcPercent: null, requiredPercent: null, satisfied: true },
      reason: "Qualifies under USMCA Criterion A (Wholly Originating).",
    };
  }

  // Check Tariff Shift (Default CTH - Change in Tariff Heading)
  const shift = checkTariffShift(input.finishedProductHtsus, input.nonOriginatingMaterials, "CTH");

  // Calculate RVC
  let rvcPercent: number | null = null;
  let rvcSatisfied = false;
  let rvcMethod: "transaction_value" | "net_cost" | "not_calculated" = "not_calculated";
  const reqRvc = input.requiredRvcPercent ?? 60;

  if (input.transactionValueUsd && input.transactionValueUsd > 0) {
    rvcMethod = "transaction_value";
    rvcPercent = Number((((input.transactionValueUsd - totalVnm) / input.transactionValueUsd) * 100).toFixed(2));
    rvcSatisfied = rvcPercent >= reqRvc;
  } else if (input.netCostUsd && input.netCostUsd > 0) {
    rvcMethod = "net_cost";
    rvcPercent = Number((((input.netCostUsd - totalVnm) / input.netCostUsd) * 100).toFixed(2));
    rvcSatisfied = rvcPercent >= (input.requiredRvcPercent ?? 50);
  }

  let qualifies = false;
  let reason = "";

  if (input.ruleType === "tariff_shift_only") {
    qualifies = shift.satisfied;
    reason = qualifies
      ? "Qualifies under USMCA Criterion B via Tariff Shift."
      : "Fails USMCA: Non-originating materials did not undergo required tariff shift.";
  } else if (input.ruleType === "rvc_only") {
    qualifies = rvcSatisfied;
    reason = qualifies
      ? `Qualifies under USMCA Criterion B via RVC (${rvcPercent}% >= ${reqRvc}%).`
      : `Fails USMCA: RVC of ${rvcPercent}% is below required ${reqRvc}%.`;
  } else if (input.ruleType === "tariff_shift_and_rvc") {
    qualifies = shift.satisfied && rvcSatisfied;
    reason = qualifies
      ? `Qualifies under USMCA Criterion B via Tariff Shift AND RVC (${rvcPercent}%).`
      : "Fails USMCA: Both Tariff Shift and RVC requirements must be satisfied.";
  } else {
    // tariff_shift_or_rvc
    qualifies = shift.satisfied || rvcSatisfied;
    reason = qualifies
      ? "Qualifies under USMCA Criterion B via alternative rule (Tariff Shift or RVC)."
      : "Fails USMCA: Neither Tariff Shift nor RVC was satisfied.";
  }

  return {
    qualifies,
    originCriterion: qualifies ? "B" : "NONE",
    tariffShiftSatisfied: shift.satisfied,
    tariffShiftDetails: shift.details,
    rvcCalculated: {
      method: rvcMethod,
      rvcPercent,
      requiredPercent: reqRvc,
      satisfied: rvcSatisfied,
    },
    reason,
  };
}

/**
 * Generate a legally compliant USMCA 9-Element Origin Certification Document.
 */
export function generateUsmcaCertificationDocument(input: UsmcaCertificateInput): string {
  const itemsText = input.items
    .map(
      (item, idx) =>
        `Item ${idx + 1}:\n` +
        `  - Description: ${item.description}\n` +
        `  - HTSUS Code: ${item.htsusCode}\n` +
        `  - Origin Criterion: ${item.originCriterion}\n` +
        `  - Producer Status: ${item.producerRole}`,
    )
    .join("\n\n");

  return (
    `=================================================================
` +
    `USMCA / CUSMA / T-MEC CERTIFICATION OF ORIGIN
` +
    `=================================================================

` +
    `1. CERTIFIER: ${input.certifier.role}
` +
    `   Name: ${input.certifier.name} (${input.certifier.title})
` +
    `   Company: ${input.certifier.companyName}
` +
    `   Address: ${input.certifier.address}
` +
    `   Tax ID: ${input.certifier.taxId} | Phone: ${input.certifier.phone} | Email: ${input.certifier.email}

` +
    `2. EXPORTER: ${input.exporter ? input.exporter.companyName + " (" + input.exporter.address + ")" : "Same as Certifier"}

` +
    `3. PRODUCER: ${input.producer ? input.producer.companyName + " (" + input.producer.address + ")" : "Same as Exporter"}

` +
    `4. IMPORTER: ${input.importer ? input.importer.companyName : "Various / As specified on Commercial Invoice"}

` +
    `5. BLANKET PERIOD: From ${input.blanketPeriod.from} To ${input.blanketPeriod.to}

` +
    `6. CERTIFIED GOODS & CLASSIFICATION:

${itemsText}

` +
    `7. CERTIFICATION STATEMENT:
` +
    `I certify that the goods described in this document qualify as originating and the information contained in this document is true and accurate. I assume responsibility for proving such representations and agree to maintain and present upon request or to make available during a verification visit, documentation necessary to support this certification.

` +
    `Authorized Signature: ${input.certifier.name}
` +
    `Date: ${new Date().toISOString().slice(0, 10)}
` +
    `=================================================================`
  );
}
