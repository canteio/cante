/**
 * ISF (Importer Security Filing / "10+2") Compliance & Penalty Prevention
 *
 * Implements CBP regulations under 19 CFR Part 149.
 * Under US Customs regulations, the 10 importer elements must be transmitted to CBP
 * via ACE at least 24 hours prior to vessel loading at the foreign port of lading.
 * Liquidated damages for late, inaccurate, or missing ISF filings are $5,000 per violation.
 */

export interface IsfImporterElements {
  /** 1. Manufacturer / Supplier name & address */
  manufacturer?: string;
  /** 2. Seller name & address */
  seller?: string;
  /** 3. Buyer name & address */
  buyer?: string;
  /** 4. Ship-to party name & address */
  shipToParty?: string;
  /** 5. Scheduled container stuffing location (flexible timing) */
  stuffingLocation?: string;
  /** 6. Consolidator (stuffer) name & address (flexible timing) */
  consolidator?: string;
  /** 7. Importer of Record number (EIN/SSN/CBP assigned) */
  importerOfRecordNumber?: string;
  /** 8. Consignee number (EIN/SSN) */
  consigneeNumber?: string;
  /** 9. Country of origin (ISO code or name) */
  countryOfOrigin?: string;
  /** 10. Commodity HTSUS code (at least 6 digits) */
  htsusCode?: string;
}

export interface IsfCarrierElements {
  /** 1. Vessel Stow Plan */
  vesselStowPlanReceived?: boolean;
  /** 2. Container Status Messages */
  containerStatusMessagesReceived?: boolean;
}

export interface IsfAuditInput {
  shipmentId: string;
  transportMode: "ocean" | "air" | "truck" | "rail";
  scheduledVesselDepartureAt?: string; // ISO string
  estimatedVesselLadingAt?: string; // ISO string
  importerElements: IsfImporterElements;
  carrierElements?: IsfCarrierElements;
  isfFiledAt?: string | null; // ISO string
}

export interface IsfAuditResult {
  isApplicable: boolean;
  isCompliant: boolean;
  hoursUntilLadingDeadline: number | null;
  filingStatus: "not_filed" | "filed_on_time" | "filed_late" | "exempt_non_ocean";
  missingElements: string[];
  penaltyExposureUsd: number;
  warnings: string[];
  actionChecklist: string[];
}

const REQUIRED_IMPORTER_ELEMENTS: Array<{ key: keyof IsfImporterElements; label: string; flexible?: boolean }> = [
  { key: "manufacturer", label: "Manufacturer (or Supplier)" },
  { key: "seller", label: "Seller" },
  { key: "buyer", label: "Buyer" },
  { key: "shipToParty", label: "Ship-to Party" },
  { key: "stuffingLocation", label: "Container Stuffing Location", flexible: true },
  { key: "consolidator", label: "Consolidator (Stuffer)", flexible: true },
  { key: "importerOfRecordNumber", label: "Importer of Record EIN/Number" },
  { key: "consigneeNumber", label: "Consignee EIN/Number" },
  { key: "countryOfOrigin", label: "Country of Origin" },
  { key: "htsusCode", label: "Commodity HTSUS 6-digit Code" },
];

/**
 * Audit an ocean freight shipment for ISF 10+2 completeness, timing, and CBP liquidated damages exposure.
 */
export function auditIsfCompliance(
  input: IsfAuditInput,
  now: Date = new Date(),
): IsfAuditResult {
  // ISF (19 CFR 149) applies strictly to ocean containerized and breakbulk cargo entering the US.
  if (input.transportMode !== "ocean") {
    return {
      isApplicable: false,
      isCompliant: true,
      hoursUntilLadingDeadline: null,
      filingStatus: "exempt_non_ocean",
      missingElements: [],
      penaltyExposureUsd: 0,
      warnings: ["ISF 10+2 is exempt for air, truck, and rail shipments."],
      actionChecklist: [],
    };
  }

  const missingElements: string[] = [];
  for (const elem of REQUIRED_IMPORTER_ELEMENTS) {
    const val = input.importerElements[elem.key];
    if (!val || typeof val !== "string" || !val.trim()) {
      missingElements.push(elem.label);
    }
  }

  // Validate HTSUS length
  if (input.importerElements.htsusCode) {
    const cleanHts = input.importerElements.htsusCode.replace(/[^0-9]/g, "");
    if (cleanHts.length < 6) {
      missingElements.push("Valid 6-digit HTSUS Code (current is less than 6 digits)");
    }
  }

  const warnings: string[] = [];
  const actionChecklist: string[] = [];
  let penaltyExposureUsd = 0;
  let filingStatus: IsfAuditResult["filingStatus"] = "not_filed";
  let hoursUntilLadingDeadline: number | null = null;

  // Lading deadline is 24 hours BEFORE vessel loading/departure
  const referenceLadingTime = input.estimatedVesselLadingAt || input.scheduledVesselDepartureAt;

  if (referenceLadingTime) {
    const ladingDate = new Date(referenceLadingTime);
    const deadlineDate = new Date(ladingDate.getTime() - 24 * 60 * 60 * 1000);
    hoursUntilLadingDeadline = Number(((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60)).toFixed(1));

    if (input.isfFiledAt) {
      const filedDate = new Date(input.isfFiledAt);
      if (filedDate.getTime() <= deadlineDate.getTime()) {
        filingStatus = "filed_on_time";
      } else {
        filingStatus = "filed_late";
        penaltyExposureUsd += 5000;
        warnings.push("CRITICAL: ISF was filed AFTER the 24-hour pre-loading deadline. CBP liquidated damages exposure is $5,000.");
      }
    } else {
      filingStatus = "not_filed";
      if (hoursUntilLadingDeadline <= 0) {
        penaltyExposureUsd += 5000;
        warnings.push("URGENT: 24-hour pre-lading deadline has PASSED without ISF transmission. Filing now may mitigate but remains subject to $5,000 penalty.");
      } else if (hoursUntilLadingDeadline <= 12) {
        warnings.push(`HIGH RISK: Only ${hoursUntilLadingDeadline} hours remaining before ISF 24h pre-loading cutoff.`);
      }
    }
  } else if (!input.isfFiledAt) {
    warnings.push("No estimated lading date provided. Ensure ISF is transmitted at least 24 hours before container is loaded on vessel.");
  }

  if (missingElements.length > 0) {
    penaltyExposureUsd += input.isfFiledAt ? 5000 : 0; // Inaccurate/incomplete filing fine
    warnings.push(`Missing ${missingElements.length} mandatory ISF data element(s).`);
    actionChecklist.push(...missingElements.map((m) => `Obtain and transmit ${m}`));
  }

  if (!input.isfFiledAt) {
    actionChecklist.push("Instruct US Licensed Customs Broker to transmit ISF-10 via ACE immediately.");
    actionChecklist.push("Request Bill of Lading (B/L) number and AMS House B/L from freight forwarder to match ISF match-rate in ACE.");
  }

  const isCompliant = missingElements.length === 0 && filingStatus === "filed_on_time";

  return {
    isApplicable: true,
    isCompliant,
    hoursUntilLadingDeadline,
    filingStatus,
    missingElements,
    penaltyExposureUsd,
    warnings,
    actionChecklist,
  };
}
