/**
 * UFLPA (Uyghur Forced Labor Prevention Act) high-priority-sector advisory.
 *
 * Trade compliance discovery interviews (2026-10-01) named
 * forced-labor measures as one of the stacking inputs trade teams have to
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
 * - It is bounded to ten of the twelve sectors FLETF has designated
 *   high-priority (cotton and cotton products, tomatoes and downstream
 *   products, silica-based products including polysilicon, polyvinyl
 *   chloride (PVC), aluminum, seafood, caustic soda, copper, lithium, and
 *   steel) at the HTS-chapter or heading level, drawn from three separate
 *   dated documents: the original June 17, 2022 Strategy named FOUR
 *   founding sectors (apparel, cotton and cotton products, silica-based
 *   products including polysilicon, and tomatoes and downstream products);
 *   apparel is not HTS-mapped by this module since it has no single bounded
 *   chapter/heading. PVC, aluminum, and seafood were added two years later
 *   by the separate "2024 Updates to the Strategy" (DHS/FLETF, published
 *   July 9, 2024) — a different document, not the 2022 Strategy. FLETF's
 *   "2025 Updates to the Strategy" (DHS/FLETF, published Aug. 19, 2025)
 *   designated five further sectors — caustic soda, copper, lithium, red
 *   dates/jujubes, and steel. Of those, caustic soda, copper, lithium, and
 *   steel have a single bounded HTS chapter/heading this module can map
 *   (sodium hydroxide heading 2815; copper Chapter 74; lithium oxide/
 *   hydroxide/carbonate headings 2825.20/2836.91; steel is mapped at the
 *   Chapter 72 basic-article level only, deliberately narrower than
 *   Section 232's combined Chapter 72/73 steel scope — checked here
 *   independently as a forced-labor sector, not a duty component). Red
 *   dates/jujubes is deliberately left unmapped like apparel: the fruit has
 *   no single bounded HTS line of its own and falls inside catch-all dried-
 *   fruit subheading 0813.40.90 shared with tamarinds, papayas, and other
 *   unrelated fruit, so a chapter/heading match there would be a guess, not
 *   a verified mapping — see `UFLPA_SCOPE_CAVEAT`.
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
 * - DHS/FLETF, "2025 Updates to the Strategy to Prevent the Importation of
 *   Goods Mined, Produced, or Manufactured With Forced Labor in the
 *   People's Republic of China" (published Aug. 19, 2025) —
 *   https://www.dhs.gov/sites/default/files/2025-08/25_0819_plcy_uflpa-strategy-2025-update-508.pdf —
 *   adds caustic soda, copper, jujubes (red dates), lithium, and steel as
 *   five further high-priority sectors. This module maps caustic soda,
 *   copper, lithium, and steel; jujubes/red dates has no bounded HTS line
 *   (see module doc) and is not mapped.
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
  "This checks ten of FLETF's twelve designated high-priority sectors (cotton and cotton products, tomatoes and downstream products, silica-based products including polysilicon, PVC, aluminum, seafood, caustic soda, copper, lithium, and steel) at the HTS chapter/heading level. Cotton, tomatoes, and polysilicon came from the original June 17, 2022 Strategy; PVC, aluminum, and seafood were added two years later by the separate 2024 Updates to the Strategy (July 9, 2024); caustic soda, copper, lithium, and steel were added a year after that by the 2025 Updates to the Strategy (Aug. 19, 2025) — three separate documents, not one. The 2025 Updates also designated jujubes (red dates) as a high-priority sector, but that fruit has no single bounded HTS chapter/heading of its own (it falls inside the catch-all dried-fruit subheading 0813.40.90 shared with tamarinds, papayas, and other unrelated fruit), so it is deliberately left unmapped rather than guessed, like apparel. A sector match below means the HTS code falls in a statutorily high-priority enforcement sector for Chinese-origin goods — it is NOT a determination that this specific shipment was produced in Xinjiang or by a UFLPA Entity List member, which requires supply-chain evidence no HTS code can supply.";

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
  {
    sector: "Caustic soda",
    htsPrefixes: ["2815"],
    citation: "UFLPA § 2(b)(2), 19 U.S.C. § 1307 note; DHS/FLETF, 2025 Updates to the Strategy to Prevent the Importation of Goods Mined, Produced, or Manufactured With Forced Labor in the People's Republic of China (published Aug. 19, 2025), designating caustic soda as a new high-priority sector",
    note:
      "HTS heading 2815 (sodium hydroxide / caustic soda, potassium hydroxide / caustic potash, sodium or potassium peroxide) is a FLETF high-priority sector for UFLPA enforcement on Chinese-origin goods, designated in the 2025 Updates to the Strategy. China is the world's largest producer of caustic soda, with roughly 16% of production in XUAR per the 2025 Strategy report.",
    listedEntityExamples: [
      "Xinjiang Zhongtai Group Co., Ltd. and Xinjiang Zhongtai Chemical Co., Ltd. — named in the 2025 UFLPA Strategy report as UFLPA Entity List members with documented XUAR forced-labor recruitment/transfer involvement",
    ],
  },
  {
    sector: "Copper",
    htsPrefixes: ["74"],
    citation: "UFLPA § 2(b)(2), 19 U.S.C. § 1307 note; DHS/FLETF, 2025 Updates to the Strategy to Prevent the Importation of Goods Mined, Produced, or Manufactured With Forced Labor in the People's Republic of China (published Aug. 19, 2025), designating copper as a new high-priority sector",
    note:
      "HTS Chapter 74 (copper and articles thereof) is a FLETF high-priority sector for UFLPA enforcement on Chinese-origin goods, designated in the 2025 Updates to the Strategy. This check is independent of, and in addition to, any other duty component computed elsewhere in this engine.",
    listedEntityExamples: [
      "Xinjiang Nonferrous Metals Industry Group Co., Ltd. and Zijin Mining Group Co., Ltd. — named in the 2025 UFLPA Strategy report as UFLPA Entity List members involved in XUAR copper mining/smelting/processing",
    ],
  },
  {
    sector: "Lithium",
    htsPrefixes: ["282520", "283691"],
    citation: "UFLPA § 2(b)(2), 19 U.S.C. § 1307 note; DHS/FLETF, 2025 Updates to the Strategy to Prevent the Importation of Goods Mined, Produced, or Manufactured With Forced Labor in the People's Republic of China (published Aug. 19, 2025), designating lithium as a new high-priority sector",
    note:
      "HTS subheadings 2825.20 (lithium oxide and hydroxide) and 2836.91 (lithium carbonates) are a FLETF high-priority sector for UFLPA enforcement on Chinese-origin goods, designated in the 2025 Updates to the Strategy. This chapter/heading-level match does not reach downstream lithium-ion battery or cell articles classified outside these two subheadings, which this module does not check.",
    listedEntityExamples: [
      "Xinjiang Hoshine Silicon Industry Co., Ltd. and Xinjiang Nonferrous Metals Industry Group Co., Ltd (Xinjiang Nonferrous) — named in the 2025 UFLPA Strategy report as UFLPA Entity List members with XUAR lithium-sector expansion",
    ],
  },
  {
    sector: "Steel",
    htsPrefixes: ["72"],
    citation: "UFLPA § 2(b)(2), 19 U.S.C. § 1307 note; DHS/FLETF, 2025 Updates to the Strategy to Prevent the Importation of Goods Mined, Produced, or Manufactured With Forced Labor in the People's Republic of China (published Aug. 19, 2025), designating steel as a new high-priority sector",
    note:
      "HTS Chapter 72 (iron and steel) is a FLETF high-priority sector for UFLPA enforcement on Chinese-origin goods, designated in the 2025 Updates to the Strategy. This chapter-level match does not cover downstream iron/steel articles classified in Chapter 73 (e.g. tubes, pipes, structures), which this module does not check. This check is independent of, and in addition to, any Section 232 steel duty component computed elsewhere in this engine — a shipment can be subject to both a stacked steel duty and a separate UFLPA forced-labor review. A XUAR-based steel producer was added to the UFLPA Entity List in October 2024 per the 2025 Strategy report.",
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
