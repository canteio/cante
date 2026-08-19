/**
 * US Trade Controls Screening Module
 *
 * Screens products, HTS classifications, and supplier countries against:
 * 1. Section 301 / Section 232 Tariff Actions
 * 2. AD/CVD (Antidumping and Countervailing Duty) orders
 * 3. UFLPA (Uyghur Forced Labor Prevention Act) high-risk sectors & supply chain flags
 * 4. PGA (Partner Government Agency) regulatory flags (EPA TSCA, OSHA, CPSC)
 */

export interface UsTradeControlsInput {
  htsCode?: string;
  productDescription: string;
  countryOfOrigin?: string; // ISO or common name
  materialsChemicals?: string[];
}

export interface TradeControlHit {
  type: "section_301" | "section_232" | "ad_cvd" | "uflpa" | "pga_epa_tsca" | "pga_cpsc" | "pga_osha";
  severity: "high" | "medium" | "info";
  title: string;
  detail: string;
  actionRequired: string;
}

export interface UsTradeControlsResult {
  hasFlags: boolean;
  hits: TradeControlHit[];
}

function cleanHts(hts?: string): string {
  return (hts ?? "").replace(/[^0-9]/g, "").slice(0, 6);
}

function isChina(country?: string): boolean {
  if (!country) return false;
  const c = country.toLowerCase().trim();
  return c === "china" || c === "cn" || c === "prc" || c === "people's republic of china";
}

/**
 * Screen product facts against US trade remedies, forced labor, and PGA regulations.
 */
export function screenUsTradeControls(input: UsTradeControlsInput): UsTradeControlsResult {
  const hits: TradeControlHit[] = [];
  const hts6 = cleanHts(input.htsCode);
  const text = (input.productDescription + " " + (input.materialsChemicals ?? []).join(" ")).toLowerCase();
  const chinaOrigin = isChina(input.countryOfOrigin);

  // 1. Section 301 (China Tariffs)
  if (chinaOrigin) {
    const isPlastic = hts6.startsWith("39") || text.includes("pvc") || text.includes("plastic");
    const isTextile = hts6.startsWith("59") || hts6.startsWith("63") || text.includes("fabric") || text.includes("tarpaulin");
    const isChemical = hts6.startsWith("28") || hts6.startsWith("29") || hts6.startsWith("38") || text.includes("chemical") || text.includes("additive");

    if (isPlastic || isTextile || isChemical) {
      hits.push({
        type: "section_301",
        severity: "high",
        title: "Section 301 China Tariff Exposure (7.5% - 25% Ad Valorem)",
        detail: `Goods under HTS ${input.htsCode || "this chapter"} of China origin are subject to Section 301 additional tariffs under List 3/4A.`,
        actionRequired: "Confirm HTS 8-digit tariff line with your customs broker and check for active exclusion extensions under HTS Chapter 99.",
      });
    }
  }

  // 2. AD/CVD (Antidumping / Countervailing Duties)
  const isVinylOrPvc = text.includes("vinyl") || text.includes("pvc") || text.includes("polyvinyl") || hts6.startsWith("3920") || hts6.startsWith("3921");
  const isPolyester = text.includes("polyester") || hts6.startsWith("5402") || hts6.startsWith("5903");

  if (isVinylOrPvc && (chinaOrigin || input.countryOfOrigin?.toLowerCase().includes("vietnam") || input.countryOfOrigin?.toLowerCase().includes("taiwan"))) {
    hits.push({
      type: "ad_cvd",
      severity: "high",
      title: "AD/CVD Scope Alert: Vinyl / PVC Coated Products & Sheeting",
      detail: "The US Department of Commerce maintains active AD/CVD orders and circumvention inquiries on rigid/flexible vinyl products and flooring from East/Southeast Asia.",
      actionRequired: "Verify with broker whether goods fall under active AD/CVD case scope to prevent retroactive cash deposit assessment upon CBP liquidation.",
    });
  }

  if (isPolyester && (chinaOrigin || input.countryOfOrigin?.toLowerCase().includes("india"))) {
    hits.push({
      type: "ad_cvd",
      severity: "medium",
      title: "AD/CVD Alert: Polyester Textured Yarn & Industrial Fabric",
      detail: "Active anti-dumping duty orders cover polyester filament yarns and woven fabrics from selected Asian origins.",
      actionRequired: "Request mill test certificates and producer-specific anti-dumping rate confirmation from supplier.",
    });
  }

  // 3. UFLPA (Uyghur Forced Labor Prevention Act)
  const hasPolymerOrTextileRisk = isVinylOrPvc || isPolyester || text.includes("cotton") || text.includes("silica");
  if (hasPolymerOrTextileRisk && (chinaOrigin || !input.countryOfOrigin)) {
    hits.push({
      type: "uflpa",
      severity: "high",
      title: "UFLPA Supply Chain Traceability Risk (CBP Detention Exposure)",
      detail: "PVC polymers, coal-based vinyl, and synthetic textile inputs from China are high-priority enforcement sectors under UFLPA rebuttable presumption.",
      actionRequired: "Obtain complete supply chain map (Tier 1 manufacturer through raw resin/feedstock origin) and Non-Xinjiang sourcing certificate before shipment departs.",
    });
  }

  // 4. PGA Flags (EPA TSCA, OSHA SDS, CPSC)
  if (text.includes("pvc") || text.includes("plasticizer") || text.includes("dop") || text.includes("phthalate") || text.includes("stabilizer") || hts6.startsWith("2917") || hts6.startsWith("3812") || hts6.startsWith("3904")) {
    hits.push({
      type: "pga_epa_tsca",
      severity: "medium",
      title: "EPA TSCA Section 6 & 13 Positive Certification Required",
      detail: "Imported industrial chemicals, plasticizers, and plastic additives must be certified compliant under TSCA (Toxic Substances Control Act) on customs entry.",
      actionRequired: "Ensure commercial invoice carries formal TSCA Positive Certification Statement and supplier provides compliant SDS with CAS numbers.",
    });
  }

  if (text.includes("flammability") || text.includes("tarpaulin") || text.includes("fabric") || hts6.startsWith("6306") || hts6.startsWith("5903")) {
    hits.push({
      type: "pga_cpsc",
      severity: "info",
      title: "CPSC / Flammability & Consumer Safety Standards",
      detail: "Coated textile covers and tarpaulins distributed in commercial or consumer channels may require flammability test compliance (CFR Title 16).",
      actionRequired: "Review end-use distribution states and retain certified lab flammability test reports on file.",
    });
  }

  return {
    hasFlags: hits.length > 0,
    hits,
  };
}
