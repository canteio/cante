/**
 * Dual-Use Export Controls & ECCN / EAR99 Screener
 *
 * Implements US Export Administration Regulations (EAR - 15 CFR Parts 730-774).
 * Evaluates:
 * 1. ECCN (Export Control Classification Number) vs EAR99.
 * 2. Country Group (15 CFR Part 740 Supp. 1) & Reason for Control (NS, CB, NP, AT).
 * 3. License Determination: NLR (No License Required), BIS License Required, or OFAC Embargo.
 */

export interface ExportScreeningInput {
  productDescription: string;
  eccn?: string; // e.g. "1C008", "2B350", "EAR99"
  destinationCountry: string; // Country name or 2-letter ISO
  endUserType?: "commercial" | "government" | "military" | "unverified";
  intendedEndUse?: string;
}

export interface ExportScreeningResult {
  isControlled: boolean;
  classification: string; // ECCN or "EAR99"
  destinationStatus: "cleared" | "country_of_concern" | "embargoed_destination";
  licenseDetermination: "NLR" | "LICENSE_REQUIRED" | "LICENSE_EXCEPTION_ELIGIBLE" | "PROHIBITED_EMBARGO";
  reasonsForControl: string[];
  applicableLicenseExceptions: string[];
  warnings: string[];
  guidance: string;
}

// 15 CFR 740 Supp. 1 - Country Group E (Terrorist supporting / comprehensive embargoes)
const EMBARGOED_COUNTRIES = new Set(["cuba", "cu", "iran", "ir", "north korea", "kp", "syria", "sy", "crimea", "donetsk", "luhansk"]);

// Country Group D:1 / D:5 (National security concern / arms embargoed)
const COUNTRIES_OF_CONCERN = new Set([
  "china", "cn", "prc", "russia", "ru", "belarus", "by", "myanmar", "burma", "mm", "venezuela", "ve", "cambodia", "kh"
]);

// Country Group A:1 / A:5 (Allies & Multilateral Regime members)
const ALLIED_COUNTRIES = new Set([
  "canada", "ca", "united kingdom", "gb", "uk", "germany", "de", "japan", "jp", "australia", "au",
  "france", "fr", "netherlands", "nl", "south korea", "kr", "taiwan", "tw", "singapore", "sg"
]);

/** Known dual-use controlled industrial / chemical / polymer categories */
const KNOWN_CONTROLLED_PATTERNS = [
  { pattern: /fluoropolymer|perfluoroalkoxy|ptfe/i, eccn: "1C009", reason: ["NP", "AT"], note: "Fluorinated polymers and compounds" },
  { pattern: /polyimide|aromatic polyimide/i, eccn: "1C008", reason: ["NS", "AT"], note: "High performance polyimide substances" },
  { pattern: /carbon fiber|prepreg/i, eccn: "1C010", reason: ["NS", "AT"], note: "Fibrous or filamentary materials" },
  { pattern: /glass lined|hastelloy|tantalum reactor/i, eccn: "2B350", reason: ["CB", "AT"], note: "Chemical manufacturing reaction vessels and valves" },
  { pattern: /triethanolamine|phosphorus oxychloride|thiodiglycol/i, eccn: "1C350", reason: ["CB", "AT"], note: "Chemical Weapons Convention precursor chemicals" },
];

/**
 * Screen an export transaction against US EAR and OFAC dual-use export control rules.
 */
export function screenUsExportControls(input: ExportScreeningInput): ExportScreeningResult {
  const dest = input.destinationCountry.toLowerCase().trim();
  const desc = input.productDescription.toLowerCase();
  const warnings: string[] = [];
  const reasonsForControl: string[] = [];
  const applicableLicenseExceptions: string[] = [];

  // 1. Embargo Check (15 CFR Part 746 & OFAC Sanctions)
  if (EMBARGOED_COUNTRIES.has(dest)) {
    return {
      isControlled: true,
      classification: input.eccn || "EAR99",
      destinationStatus: "embargoed_destination",
      licenseDetermination: "PROHIBITED_EMBARGO",
      reasonsForControl: ["EMBARGO"],
      applicableLicenseExceptions: [],
      warnings: [`CRITICAL: Comprehensive US trade embargo in effect for ${input.destinationCountry}. Exports strictly prohibited under OFAC and EAR Part 746.`],
      guidance: "Do not export. Transaction requires specific license authorization from OFAC and BIS.",
    };
  }

  // 2. Classification Determination (ECCN vs EAR99)
  let classification = (input.eccn || "").toUpperCase().trim();
  if (!classification) {
    // Check known controlled dual-use patterns
    const match = KNOWN_CONTROLLED_PATTERNS.find((p) => p.pattern.test(desc));
    if (match) {
      classification = match.eccn;
      reasonsForControl.push(...match.reason);
      warnings.push(`Product description matches controlled ECCN ${match.eccn} (${match.note}).`);
    } else {
      classification = "EAR99";
    }
  }

  const isControlled = classification !== "EAR99";
  const isConcern = COUNTRIES_OF_CONCERN.has(dest);
  const isAllied = ALLIED_COUNTRIES.has(dest);
  const destinationStatus = isConcern ? "country_of_concern" : "cleared";

  // 3. Military End-Use / End-User Rule (15 CFR 744.21)
  if (isConcern && (input.endUserType === "military" || desc.includes("military") || desc.includes("defense"))) {
    warnings.push("CRITICAL: Military End-Use / Military End-User (MEU) rule applies under 15 CFR 744.21. License required even for certain EAR99 items.");
    return {
      isControlled: true,
      classification,
      destinationStatus: "country_of_concern",
      licenseDetermination: "LICENSE_REQUIRED",
      reasonsForControl: ["MEU", ...reasonsForControl],
      applicableLicenseExceptions: [],
      warnings,
      guidance: "A BIS export license is required due to military end-user / end-use nexus in a country of concern.",
    };
  }

  // 4. License Determination
  let licenseDetermination: ExportScreeningResult["licenseDetermination"] = "NLR";

  if (isControlled) {
    if (isAllied) {
      licenseDetermination = "LICENSE_EXCEPTION_ELIGIBLE";
      applicableLicenseExceptions.push("STA (Strategic Trade Authorization)", "GBS (Shipments to Group B Countries)");
    } else if (isConcern) {
      licenseDetermination = "LICENSE_REQUIRED";
      warnings.push(`Exports of ECCN ${classification} to ${input.destinationCountry} require a specific BIS export license.`);
    } else {
      licenseDetermination = "LICENSE_REQUIRED";
    }
  } else {
    // EAR99
    licenseDetermination = "NLR";
    if (input.endUserType === "unverified") {
      warnings.push("End-user is unverified. Perform Consolidated Screening List (CSL) check before shipping under NLR.");
    }
  }

  const guidance =
    licenseDetermination === "NLR"
      ? `Eligible for export under NLR (No License Required) for commodity ${classification} to ${input.destinationCountry}.`
      : licenseDetermination === "LICENSE_EXCEPTION_ELIGIBLE"
      ? `Eligible for export under License Exception (${applicableLicenseExceptions.join(", ")}) subject to 15 CFR 740 compliance.`
      : `BIS Export License Required prior to export of ${classification} to ${input.destinationCountry}.`;

  return {
    isControlled,
    classification,
    destinationStatus,
    licenseDetermination,
    reasonsForControl,
    applicableLicenseExceptions,
    warnings,
    guidance,
  };
}
