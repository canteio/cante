/**
 * UFLPA (Uyghur Forced Labor Prevention Act) high-priority-sector advisory.
 *
 * Kate Chang (Toro Company, customer-discovery interview 2026-10-01) named
 * forced-labor measures as one of the stacking inputs her team has to
 * evaluate by hand. Until now `stack.ts` only ever named "Forced-labor
 * measures (e.g. UFLPA detentions/withhold-release orders)" in
 * `notEvaluated` with no data behind it. This module adds the one piece
 * Cante can respond to honestly without fabricating anything: whether the
 * declared HTS code falls inside one of the statute's own named
 * high-priority enforcement sectors for Chinese-origin goods.
 *
 * What this module is NOT:
 * - It does NOT determine whether a specific shipment was produced wholly
 *   or in part in Xinjiang, or by a specific entity on the UFLPA Entity
 *   List. That requires supply-chain tracing evidence an HTS code cannot
 *   supply (CBP's own guidance: "clear and convincing evidence" standard
 *   on the importer, case by case).
 * - It does NOT return a computed duty amount. The UFLPA presumption is
 *   binary (detain/exclude), not a percentage, so there is no duty-stack
 *   component here, unlike Section 301/232/338.
 * - It is bounded to six of the sectors FLETF has designated high-priority
 *   (cotton and cotton products, tomatoes and downstream products,
 *   silica-based products including polysilicon, polyvinyl chloride (PVC),
 *   aluminum, and seafood) at the HTS-chapter or heading level, drawn from
 *   two separate dated documents: the original June 17, 2022 Strategy named
 *   FOUR founding sectors (apparel, cotton and cotton products, silica-
 *   based products including polysilicon, and tomatoes and downstream
 *   products); apparel is not HTS-mapped by this module since it has no
 *   single bounded chapter/heading. PVC, aluminum, and seafood were added
 *   two years later by the separate "2024 Updates to the Strategy" (DHS/
 *   FLETF, published July 9, 2024) — a different document, not the 2022
 *   Strategy. FLETF has since designated further high-priority sectors in
 *   the "2025 Updates to the Strategy" (caustic soda, copper, lithium, red
 *   dates/jujubes, steel) that this module does not hold verified HTS
 *   mappings or citations for. Those later sectors are deliberately left
 *   unmodeled rather than guessed — see `UFLPA_SCOPE_CAVEAT`.
 * - It only fires for declared country of origin "CN". The UFLPA
 *   presumption actually keys off Xinjiang production/entity linkage, not
 *   declared country of origin alone — a transshipped good relabeled with a
 *   third-country origin would not be caught by this check, and this is a
 *   named limitation, not a silent gap.
 *
 * Primary sources:
 * - UFLPA, Pub. L. 117-78, § 2(b)(2), 135 Stat. 1525 (Dec. 23, 2021); 19
 *   U.S.C. § 1307 note.
 * - DHS/FLETF, "Strategy to Prevent the Importation of Goods Mined,
 *   Produced, or Manufactured With Forced Labor in the People's Republic
 *   of China" (June 17, 2022) — names apparel, cotton, tomatoes, and
 *   silica-based products (polysilicon) as the four founding high-priority
 *   sectors.
 * - DHS/FLETF, "2024 Updates to the Strategy to Prevent the Importation of
 *   Goods Mined, Produced, or Manufactured With Forced Labor in the
 *   People's Republic of China" (published July 9, 2024) — adds polyvinyl
 *   chloride (PVC), aluminum, and seafood as three further high-priority
 *   sectors.
 * - DHS UFLPA Entity List (https://www.dhs.gov/uflpa-entity-list), 19
 *   U.S.C. § 1307 note implementing Federal Register notices for each
 *   addition (e.g. 89 FR 87391, Nov. 1, 2024, FR Doc 2024-25423 — Esquel
 *   Group and subsidiaries; this supersedes the Oct. 3, 2024 list at 89 FR
 *   80586).
 */

export interface UflpaSector {
  sector: string;
  /** HTS chapter (2-digit) or heading (4-digit) prefixes this sector check matches against. */
  htsPrefixes: string[];
  citation: string;
  note: string;
  /** Named real UFLPA Entity List example(s) operating in this sector — illustrative, never a claim that a specific shipment involves them. */
  listedEntityExamples?: string[];
}

export const UFLPA_SCOPE_CAVEAT =
  "This checks only six of FLETF's designated high-priority sectors (cotton and cotton products, tomatoes and downstream products, silica-based products including polysilicon, PVC, aluminum, and seafood) at the HTS chapter/heading level. Cotton, tomatoes, and polysilicon came from the original June 17, 2022 Strategy; PVC, aluminum, and seafood were added two years later by the separate 2024 Updates to the Strategy (July 9, 2024) — not the same document. FLETF's 2025 Updates to the Strategy (Aug. 19, 2025) designated further high-priority sectors (caustic soda, copper, lithium, red dates/jujubes, and steel) that this module does not hold verified HTS mappings or Federal Register citations for, so they are not checked. A sector match below means the HTS code falls in a statutorily high-priority enforcement sector for Chinese-origin goods — it is NOT a determination that this specific shipment was produced in Xinjiang or by a UFLPA Entity List member, which requires supply-chain evidence no HTS code can supply.";

export const UFLPA_HIGH_PRIORITY_SECTORS: UflpaSector[] = [
  {
    sector: "Cotton and cotton products",
    htsPrefixes: ["52"],
    citation:
      "UFLPA § 2(b)(2), 19 U.S.C. § 1307 note; FLETF Strategy (June 17, 2022) at 8 (cotton named as a founding high-priority sector; XUAR produces an estimated ~85% of China's cotton)",
    note:
      "HTS Chapter 52 (cotton, cotton yarn, and cotton fabric) is a FLETF high-priority sector for UFLPA enforcement on Chinese-origin goods. This chapter-level match does not cover downstream cotton apparel/textile articles classified outside Chapter 52 (e.g. finished garments in Chapters 61/62), which this module does not check.",
    listedEntityExamples: [
      "Esquel Group and subsidiaries Changji Esquel Textile Co., Ltd., Turpan Esquel Textile Co., Ltd., and Guangdong Esquel Textile Co., Ltd. — added to the UFLPA Entity List effective Nov. 1, 2024 (89 FR 87391, FR Doc 2024-25423, Nov. 1, 2024)",
    ],
  },
  {
    sector: "Tomatoes and tomato products",
    htsPrefixes: ["0702", "2002"],
    citation: "UFLPA § 2(b)(2), 19 U.S.C. § 1307 note; FLETF Strategy (June 17, 2022) at 8",
    note:
      "HTS headings 0702 (tomatoes, fresh or chilled) and 2002 (tomatoes prepared or preserved) are a FLETF high-priority sector for UFLPA enforcement on Chinese-origin goods.",
  },
  {
    sector: "Silica-based products, including polysilicon",
    htsPrefixes: ["280461"],
    citation: "UFLPA § 2(b)(2), 19 U.S.C. § 1307 note; FLETF Strategy (June 17, 2022) at 8",
    note:
      "HTS heading 2804.61 (silicon containing by weight not less than 99.99% silicon, i.e. polysilicon) is a FLETF high-priority sector for UFLPA enforcement on Chinese-origin goods. XUAR is estimated to produce roughly a third of the world's polysilicon supply.",
    listedEntityExamples: [
      "Hoshine Silicon Industry (Shanshan) Co., Ltd. and subsidiaries — originally subject to a CBP Withhold Release Order (June 24, 2021); added to the UFLPA Entity List effective June 21, 2022 (DHS UFLPA Entity List)",
    ],
  },
  {
    sector: "Polyvinyl chloride (PVC)",
    htsPrefixes: ["3904"],
    citation: "UFLPA § 2(b)(2), 19 U.S.C. § 1307 note; DHS/FLETF, 2024 Updates to the Strategy to Prevent the Importation of Goods Mined, Produced, or Manufactured With Forced Labor in the People's Republic of China (published July 9, 2024), designating PVC as a new high-priority sector",
    note:
      "HTS heading 3904 (polymers of vinyl chloride) is a FLETF high-priority sector for UFLPA enforcement on Chinese-origin goods, designated in the 2024 Updates to the Strategy (not the original 2022 Strategy).",
  },
  {
    sector: "Aluminum and aluminum products",
    htsPrefixes: ["76"],
    citation: "UFLPA § 2(b)(2), 19 U.S.C. § 1307 note; DHS/FLETF, 2024 Updates to the Strategy to Prevent the Importation of Goods Mined, Produced, or Manufactured With Forced Labor in the People's Republic of China (published July 9, 2024), designating aluminum as a new high-priority sector",
    note:
      "HTS Chapter 76 (aluminum and articles thereof) is a FLETF high-priority sector for UFLPA enforcement on Chinese-origin goods, designated in the 2024 Updates to the Strategy (not the original 2022 Strategy). This check is independent of, and in addition to, any Section 232/338 aluminum duty component computed elsewhere in this engine — a shipment can be subject to both a stacked aluminum duty and a separate UFLPA forced-labor review.",
  },
  {
    sector: "Seafood",
    htsPrefixes: ["03"],
    citation: "UFLPA § 2(b)(2), 19 U.S.C. § 1307 note; DHS/FLETF, 2024 Updates to the Strategy to Prevent the Importation of Goods Mined, Produced, or Manufactured With Forced Labor in the People's Republic of China (published July 9, 2024), designating seafood as a new high-priority sector",
    note:
      "HTS Chapter 3 (fish and crustaceans) is a FLETF high-priority sector for UFLPA enforcement on Chinese-origin goods, designated in the 2024 Updates to the Strategy (not the original 2022 Strategy), including seafood processed in China from catch originating elsewhere.",
  },
];

function digits(code: string): string {
  return code.replace(/\D/g, "");
}

export interface UflpaAdvisory {
  sector: string;
  citation: string;
  note: string;
  listedEntityExamples: string[];
  /** Always false — a sector/HTS match is never proof of actual Entity List membership or Xinjiang origin. */
  determinesForcedLaborStatus: false;
}

/**
 * Returns every FLETF high-priority sector whose HTS prefix the given code
 * falls under, for declared country of origin "CN" only. Never a
 * forced-labor determination — see module doc and `UFLPA_SCOPE_CAVEAT`.
 */
export function lookupUflpaAdvisories(htsCode: string, countryOfOrigin: string): UflpaAdvisory[] {
  const code = digits(htsCode);
  const country = countryOfOrigin.trim().toUpperCase();
  if (!code || country !== "CN") return [];

  return UFLPA_HIGH_PRIORITY_SECTORS.filter((entry) =>
    entry.htsPrefixes.some((prefix) => code.startsWith(prefix)),
  ).map((entry) => ({
    sector: entry.sector,
    citation: entry.citation,
    note: entry.note,
    listedEntityExamples: entry.listedEntityExamples ?? [],
    determinesForcedLaborStatus: false,
  }));
}
