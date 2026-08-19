/**
 * US Chemical & Substance Controls: EPA TSCA & California Proposition 65
 *
 * Implements:
 * 1. EPA TSCA Section 8(a)(7) PFAS (Per- and Polyfluoroalkyl Substances) reporting (40 CFR Part 705).
 * 2. EPA TSCA Section 6 Persistent, Bioaccumulative, and Toxic (PBT) chemical bans (40 CFR Part 751).
 * 3. California Proposition 65 Safe Harbor screening and statutory warning label generator (27 CCR § 25600+).
 */

export interface ChemicalSubstanceInput {
  chemicalName: string;
  casNumber?: string;
  concentrationPercent?: number;
  intendedFunction?: string; // e.g. "plasticizer", "flame retardant", "water repellent", "pigment"
}

export interface UsChemicalScreeningInput {
  productName: string;
  productCategory: "plastics_vinyl" | "textiles_coated" | "industrial_chemical" | "consumer_goods" | "other";
  distributedInCalifornia?: boolean;
  substances: ChemicalSubstanceInput[];
}

export interface SubstanceFlag {
  substance: string;
  casNumber?: string;
  framework: "EPA_TSCA_PFAS" | "EPA_TSCA_PBT" | "CALIFORNIA_PROP_65";
  severity: "PROHIBITED" | "REPORTING_MANDATED" | "WARNING_REQUIRED";
  summary: string;
  actionRequired: string;
}

export interface UsChemicalScreeningResult {
  hasFlags: boolean;
  tscaPfasReportable: boolean;
  tscaPbtProhibited: boolean;
  prop65WarningRequired: boolean;
  flags: SubstanceFlag[];
  prop65WarningLabelText: string | null;
}

// EPA TSCA Section 6 PBT Prohibited Chemicals (40 CFR 751.401-415)
const TSCA_PBT_REGISTRY: Array<{ name: string; aliases: string[]; cas: string; rule: string }> = [
  { name: "DecaBDE", aliases: ["decabromodiphenyl ether", "bis(pentabromophenyl) ether"], cas: "1163-19-5", rule: "Prohibited in all plastics and textiles." },
  { name: "PIP (3:1)", aliases: ["phenol, isopropylated phosphate (3:1)", "tris(isopropylphenyl) phosphate"], cas: "68937-41-7", rule: "Prohibited in industrial plasticizers and lubricants." },
  { name: "PCTP", aliases: ["pentachlorothiophenol"], cas: "133-49-3", rule: "Restricted concentration <= 1%." },
  { name: "2,4,6-TTBP", aliases: ["2,4,6-tris(tert-butyl)phenol"], cas: "732-26-3", rule: "Restricted concentration <= 0.3%." },
];

// High-profile California Prop 65 substances common in plastics, vinyl, and coated tarpaulins
const PROP65_PLASTICS_REGISTRY: Array<{ name: string; aliases: string[]; cas?: string; endpoint: string }> = [
  { name: "DEHP", aliases: ["di(2-ethylhexyl) phthalate", "bis(2-ethylhexyl) phthalate"], cas: "117-81-7", endpoint: "Cancer and reproductive harm" },
  { name: "DINP", aliases: ["diisononyl phthalate"], cas: "28553-12-0", endpoint: "Cancer" },
  { name: "DBP", aliases: ["dibutyl phthalate"], cas: "84-74-2", endpoint: "Reproductive harm" },
  { name: "DIDP", aliases: ["diisodecyl phthalate"], cas: "26761-40-0", endpoint: "Reproductive harm" },
  { name: "Antimony Trioxide", aliases: ["antimony oxide", "antimony(iii) oxide"], cas: "1309-64-4", endpoint: "Cancer" },
  { name: "Lead & Lead Compounds", aliases: ["lead", "lead stabilizer"], cas: "7439-92-1", endpoint: "Cancer and reproductive harm" },
];

/**
 * Screen chemical formulations and product bills of materials for TSCA PFAS, TSCA PBT bans, and CA Prop 65.
 */
export function screenUsChemicalControls(input: UsChemicalScreeningInput): UsChemicalScreeningResult {
  const flags: SubstanceFlag[] = [];
  let tscaPfasReportable = false;
  let tscaPbtProhibited = false;
  let prop65WarningRequired = false;
  const prop65ChemicalsFound: string[] = [];

  for (const s of input.substances) {
    const sName = s.chemicalName.toLowerCase();
    const cas = (s.casNumber ?? "").trim();

    // 1. EPA TSCA Section 8(a)(7) PFAS Check
    const isPfas =
      sName.includes("pfas") ||
      sName.includes("perfluoro") ||
      sName.includes("polyfluoro") ||
      sName.includes("ptfe") ||
      sName.includes("pvdf") ||
      sName.includes("fluoropolymer") ||
      (s.intendedFunction?.toLowerCase().includes("water repellent") && sName.includes("fluoro"));

    if (isPfas) {
      tscaPfasReportable = true;
      flags.push({
        substance: s.chemicalName,
        casNumber: cas || undefined,
        framework: "EPA_TSCA_PFAS",
        severity: "REPORTING_MANDATED",
        summary: "Per- and polyfluoroalkyl substance (PFAS) identified. Subject to EPA TSCA Section 8(a)(7) mandatory reporting.",
        actionRequired: "Compile manufacturing/import volume, chemical identity, worker exposure data, and submit reporting dossier via EPA CDX portal under 40 CFR Part 705.",
      });
    }

    // 2. EPA TSCA Section 6 PBT Ban Check
    const pbtMatch = TSCA_PBT_REGISTRY.find(
      (p) => (cas && p.cas === cas) || p.aliases.some((a) => sName.includes(a)) || sName.includes(p.name.toLowerCase()),
    );

    if (pbtMatch) {
      tscaPbtProhibited = true;
      flags.push({
        substance: s.chemicalName,
        casNumber: cas || pbtMatch.cas,
        framework: "EPA_TSCA_PBT",
        severity: "PROHIBITED",
        summary: `TSCA Section 6 PBT Prohibited Chemical: ${pbtMatch.name} (${pbtMatch.rule})`,
        actionRequired: "Cease import and distribution immediately. Request certified PBT-free reformulation from raw material supplier.",
      });
    }

    // 3. California Proposition 65 Check
    const prop65Match = PROP65_PLASTICS_REGISTRY.find(
      (p) => (cas && p.cas === cas) || p.aliases.some((a) => sName.includes(a)) || sName.includes(p.name.toLowerCase()),
    );

    if (prop65Match && (input.distributedInCalifornia !== false)) {
      prop65WarningRequired = true;
      prop65ChemicalsFound.push(prop65Match.name);
      flags.push({
        substance: s.chemicalName,
        casNumber: cas || prop65Match.cas,
        framework: "CALIFORNIA_PROP_65",
        severity: "WARNING_REQUIRED",
        summary: `California Prop 65 Listed Chemical: ${prop65Match.name} (Known to cause ${prop65Match.endpoint}).`,
        actionRequired: "Apply compliant Proposition 65 warning label on product packaging and commercial documentation to prevent private-enforcer citizen suits.",
      });
    }
  }

  let prop65WarningLabelText: string | null = null;
  if (prop65WarningRequired && prop65ChemicalsFound.length > 0) {
    const chemicalList = Array.from(new Set(prop65ChemicalsFound)).join(", ");
    prop65WarningLabelText =
      `⚠️ WARNING: This product can expose you to chemicals including ${chemicalList}, ` +
      `which is known to the State of California to cause cancer and birth defects or other reproductive harm. ` +
      `For more information, go to www.P65Warnings.ca.gov.`;
  }

  return {
    hasFlags: flags.length > 0,
    tscaPfasReportable,
    tscaPbtProhibited,
    prop65WarningRequired,
    flags,
    prop65WarningLabelText,
  };
}
