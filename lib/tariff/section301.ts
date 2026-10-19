import coverageSnapshot from "./section301-coverage.json";

/**
 * Section 301 (China): live USITC references plus the comprehensive USITC
 * China Tariffs coverage snapshot, resolved through the verified rate table.
 *
 * The USITC HTS row for a China-origin classification often carries an
 * `additionalDuties` cross-reference like "See 9903.88.03" — a pointer into
 * subchapter III of HTS Chapter 99, not a number lib/tariff/rates.ts can
 * compute with. The verified rate table
 * resolves those pointers to an actual stacked rate, with the Federal
 * Register notice that imposed it, so a caller can say *why* a number is
 * what it is instead of just printing it.
 *
 * Scope, stated plainly: the rate table covers the four China Section 301
 * "List" actions under USTR's technology-transfer investigation (the
 * 9903.88.xx headings). It does NOT cover Section 232 steel/aluminum/auto
 * derivatives, USMCA/FTA rules-of-origin qualification, AD/CVD orders, or
 * forced-labor (UFLPA) measures — those require their own reference data
 * and are deliberately left unresolved rather than guessed at. See
 * `lib/tariff/stack.ts` for how an unresolved measure is reported.
 *
 * The comprehensive coverage snapshot also retains newer headings whose rates
 * are not in this table; those remain explicitly unresolved in the stack.
 *
 * Every rate entry below is a verified historical fact (list composition,
 * in-force rate, effective date, Federal Register citation), checked
 * against USTR and Federal Register primary sources. Rates that were
 * modified after initial imposition reflect the *current* in-force rate,
 * with both the original and modifying notice cited.
 */

export interface Section301Measure {
  /** The Chapter 99 heading as it appears in an HTS row, e.g. "9903.88.03". */
  chapter99Code: string;
  /** Human label for the USTR action, e.g. "China Section 301 – List 3". */
  list: string;
  /** Country this measure applies to. Section 301 China actions: "CN" only. */
  country: "CN";
  /** Whether the measure is currently in force. */
  status: "active" | "suspended";
  /** Current in-force ad valorem rate, as a fraction (25% -> 0.25). Null when suspended. */
  ratePercent: number | null;
  /** Date the *current* rate took effect (ISO date). */
  effectiveDate: string;
  /** Federal Register citation(s) establishing/modifying the current rate. */
  federalRegisterCitations: string[];
  /** One line of plain-English provenance, for the explanation layer. */
  note: string;
}

/**
 * Indexed by the Chapter 99 heading. Deliberately small and exact rather
 * than broad and approximate — see the module doc.
 */
export const SECTION_301_CHINA_MEASURES: Record<string, Section301Measure> = {
  "9903.88.01": {
    chapter99Code: "9903.88.01",
    list: "China Section 301 – List 1",
    country: "CN",
    status: "active",
    ratePercent: 0.25,
    effectiveDate: "2018-07-06",
    federalRegisterCitations: ["83 FR 28710 (June 20, 2018)"],
    note: "25% ad valorem on ~818 tariff subheadings (~$34B trade value), imposed at 25% from the start — no step-up.",
  },
  "9903.88.02": {
    chapter99Code: "9903.88.02",
    list: "China Section 301 – List 2",
    country: "CN",
    status: "active",
    ratePercent: 0.25,
    effectiveDate: "2018-08-23",
    federalRegisterCitations: ["83 FR 40823 (August 16, 2018)"],
    note: "25% ad valorem on ~279 tariff subheadings (~$16B trade value), imposed at 25% from the start — no step-up.",
  },
  "9903.88.03": {
    chapter99Code: "9903.88.03",
    list: "China Section 301 – List 3",
    country: "CN",
    status: "active",
    ratePercent: 0.25,
    effectiveDate: "2019-05-10",
    federalRegisterCitations: [
      "83 FR 47974 (September 21, 2018) — initial 10% effective 2018-09-24",
      "84 FR 20459 (May 9, 2019) — increased to 25% effective 2019-05-10",
    ],
    note: "Imposed at 10% on 2018-09-24, increased to 25% effective 2019-05-10. Covers ~5,745 subheadings (~$200B trade value).",
  },
  "9903.88.15": {
    chapter99Code: "9903.88.15",
    list: "China Section 301 – List 4A",
    country: "CN",
    status: "active",
    ratePercent: 0.075,
    effectiveDate: "2020-02-14",
    federalRegisterCitations: [
      "84 FR 43304 (August 20, 2019) — initially announced 10%",
      "84 FR 45821 — raised initial collection rate to 15% effective 2019-09-01",
      "85 FR 3741 (January 22, 2020) — reduced to 7.5% effective 2020-02-14 (Phase One agreement)",
    ],
    note: "Imposed at 15% on 2019-09-01, reduced to 7.5% effective 2020-02-14 under the US-China Phase One deal. Still in force at 7.5%.",
  },
  "9903.88.04": {
    chapter99Code: "9903.88.04",
    list: "China Section 301 – List 3 (U.S. note 20(g))",
    country: "CN",
    status: "active",
    ratePercent: 0.25,
    effectiveDate: "2019-05-10",
    federalRegisterCitations: [
      "83 FR 47974 (September 21, 2018) — initial 10% effective 2018-09-24",
      "84 FR 20459 (May 9, 2019) — increased to 25% effective 2019-05-10",
    ],
    note: "Active companion List 3 heading for the subheadings enumerated in U.S. note 20(g); increased from 10% to 25% effective 2019-05-10.",
  },
  "9903.88.16": {
    chapter99Code: "9903.88.16",
    list: "China Section 301 – List 4B",
    country: "CN",
    status: "suspended",
    ratePercent: null,
    effectiveDate: "2019-12-15",
    federalRegisterCitations: ["84 FR 69447 (December 18, 2019) — suspended indefinitely as of its planned 2019-12-15 effective date"],
    note: "List 4B (Annex C of 84 FR 43304) was suspended before collection began; heading 9903.88.16 has never been active.",
  },
};

/** Chapter-99-style reference, e.g. "9903.88.03" or embedded in "See 9903.88.03". */
const CHAPTER_99_REF = /\b9903\.\d{2}\.\d{2}\b/g;

/**
 * Pull every Chapter 99 cross-reference out of a free-text USITC
 * `additionalDuties` string, e.g. "See 9903.88.03" -> ["9903.88.03"].
 * Returns [] for null/empty/no-match input — never throws on unexpected text.
 */
export function extractChapter99Refs(additionalDuties: string | null | undefined): string[] {
  if (!additionalDuties) return [];
  const matches = additionalDuties.match(CHAPTER_99_REF);
  if (!matches) return [];
  return Array.from(new Set(matches));
}

/** Look up a known Section 301 measure by its Chapter 99 heading, or null if we have no record of it. */
export function lookupSection301Measure(chapter99Code: string): Section301Measure | null {
  return SECTION_301_CHINA_MEASURES[chapter99Code] ?? null;
}

/** Comprehensive USITC China Tariffs snapshot; periodically regenerate using
 * scripts/generate-section301-coverage.ts. Source URL and printed Last Updated
 * date are embedded in the generated JSON. A stale snapshot can miss revisions;
 * absence is unresolved, and product-specific exclusions still need review.
 * The snapshot maps coverage only; rates remain in SECTION_301_CHINA_MEASURES.
 */
export const SECTION_301_COVERAGE_CITATION =
  `USITC China Tariffs (Last Updated ${coverageSnapshot.lastUpdated}) — ${coverageSnapshot.sourceUrl}`;

export function lookupSection301Coverage(htsCode: string): { chapter99Code: string; matchedCode: string } | null {
  if (!/^(?:\d{8}|\d{10}|\d{4}\.\d{2}\.\d{2}(?:\.?\d{2})?)$/.test(htsCode)) return null;
  const digits = htsCode.replace(/\./g, "");
  const coverage: Readonly<Record<string, string>> = coverageSnapshot.coverage;
  // Never infer an eight-digit parent's coverage from one statistical child.
  // Exact ten-digit coverage overrides an eight-digit heading when both exist.
  for (const key of [digits, digits.slice(0, 8)]) {
    if (coverage[key]) return { chapter99Code: coverage[key], matchedCode: key };
  }
  return null;
}

import { load } from "cheerio";
import { remedyCitations, type OfficialRemedySnapshot, type RemedyFacts, type RemedyResolution } from "./section232-live";
const matchesCode=(codes:string[],code:string)=>codes.some(c=>code.replace(/\D/g,"").startsWith(c));
const euCountries=new Set("AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE".split(" "));
const aliases:Record<string,string[]>={CN:["China"],VN:["Vietnam"],MX:["Mexico"],GB:["United Kingdom"],KR:["South Korea","Republic of Korea","the Republic of Korea"],TW:["Taiwan"],TR:["Turkey","Türkiye"],RU:["Russian Federation","Russia"],BS:["Bahamas","The Bahamas"],CI:["Côte d’Ivoire","Côte d'Ivoire"],LA:["Laos"]};
function countryNames(code:string) { if(euCountries.has(code))return ["a member state of the European Union"];try{return aliases[code]??[new Intl.DisplayNames(["en"],{type:"region"}).of(code)??code];}catch{return [code];} }
const result301=(s:OfficialRemedySnapshot,status:RemedyResolution["status"],reason:string,heading:string|null=null,rate:number|null=null,missingFacts:string[]=[]):RemedyResolution=>{
  if(status==="resolved"&&heading&&rate===0&&!/^The duty provided in the applicable subheading$/i.test(s.headings.find(r=>r.htsno===heading)?.general.trim()??""))return {status:"pending_verification",reason:`Published no-additional-duty expression for ${heading} is missing or changed.`,heading:null,rate:null,missingFacts:[],citation:remedyCitations(s,52)};
  return {status,reason,heading,rate,missingFacts,citation:remedyCitations(s,52)};
};
/** Current Note 52 ordinary commercial treatment; exceptions remain explicit facts. */
export function resolveCurrentSection301(s:OfficialRemedySnapshot,input:{hts:string;country:string;baseRate:number|null;section232:RemedyResolution;facts?:RemedyFacts;usmcaDutyFree?:boolean}):RemedyResolution {
  if(s.issues.length)return result301(s,"pending_verification",s.issues.join(" "));
  const note=s.notes[52],facts=input.facts??{};
  const candidates=s.headings.filter(r=>/^9903\.05\.(?:[2-7]\d|8[0-4])$/.test(r.htsno)&&countryNames(input.country).some(name=>(/articles the product of ([^,]+)/i.exec(r.description)?.[1].trim().toLowerCase()===name.toLowerCase())));
  if(["RU","BY","CU","KP"].includes(input.country)&&candidates.length)return result301(s,"needs_facts","Column 2 and country-specific Section 301 treatment require a separately verified rule.",null,null,["column2_remedy_treatment"]);
  if(!candidates.length)return result301(s,"not_applicable","No Note 52 country heading matches the supplied origin.",null,0);
  if(matchesCode(note.lists["(b)"],input.hts))return result301(s,"resolved","The code is in the unconditional Note 52(b) exclusion table.","9903.05.86",0);
  if(input.usmcaDutyFree&&["MX","CA"].includes(input.country))return result301(s,"resolved","Verified duty-free USMCA entry satisfies Note 52(g)/(h).",input.country==="MX"?"9903.05.94":"9903.05.93",0);
  if(input.section232.status==="resolved"&&input.section232.heading&&/^9903\.82\.(?:02|0[4-9]|1\d|2[0-6])$/.test(input.section232.heading))return result301(s,"resolved",`Actual selected heading ${input.section232.heading} is listed in Note 52(f)(1); a generic metal match was not used as proof.`,"9903.05.90",0);
  if(input.section232.status==="needs_facts"||input.section232.status==="pending_verification")return result301(s,input.section232.status,"Section 232 heading selection must be established before applying Note 52(f).",null,null,input.section232.missingFacts);
  if(!facts.standardCommercial)return result301(s,"needs_facts","Confirm ordinary commercial imports with no Chapter 98, donation, informational-material or other special exclusion claim.",null,null,["standard_commercial"]);
  if(matchesCode(note.lists["(c)"],input.hts)||matchesCode(note.lists["(d)"],input.hts)||matchesCode(note.lists["(e)"],input.hts))return result301(s,"needs_facts","This HTS code occurs in a conditional article, civil-aircraft or pharmaceutical exclusion list. End-use/scope evidence is required.",null,null,["conditional_exclusion_scope"]);
  if(facts.other232Heading!=="none")return result301(s,"needs_facts","Confirm whether automotive, truck, wood, semiconductor or pharmaceutical Section 232 treatment applies; metal coverage alone cannot establish its absence.",null,null,["other_232_heading"]);
  for(const row of candidates) {
    const raw=row.general.trim();const add=/^The duty provided in the applicable subheading (?:\+|plus) (\d+(?:\.\d+)?)%$/.exec(raw);
    if(add)return result301(s,"resolved",`Published ${row.htsno} adds ${add[1]}% to the base and other applicable duties; no special exemption is claimed.`,row.htsno,Number(add[1])/100);
    const combined=/^(\d+(?:\.\d+)?)%$/.exec(raw);
    if(combined) {
      if(input.baseRate===null)return result301(s,"needs_facts","A combined Note 52 rate requires a calculable base-duty ad valorem equivalent.",null,null,["base_ad_valorem_equivalent"]);
      const threshold=Number(combined[1])/100;
      if(input.baseRate<threshold)return {...result301(s,"resolved",`Published ${row.htsno} sets base plus this Section 301 component to ${combined[1]}%; other duties remain separate.`,row.htsno,Number((threshold-input.baseRate).toFixed(8))),combinedRate:threshold};
    }
    if(/^The duty provided in the applicable subheading$/i.test(raw)&&/equal to or greater than/.test(row.description)) {
      const threshold=/equal to or greater than (\d+(?:\.\d+)?) percent/.exec(row.description);
      if(threshold&&input.baseRate!==null&&input.baseRate>=Number(threshold[1])/100)return result301(s,"resolved","The published combined-rate threshold is already met by the base duty.",row.htsno,0);
    }
  }
  return result301(s,"pending_verification","The current country-heading rate expression or threshold is not understood; no rate was guessed.");
}
/** Resolve legacy China list coverage from the same newly fetched note/rate snapshot. */
export function resolveCurrentChina301(s:OfficialRemedySnapshot,hts:string):RemedyResolution {
  if(s.issues.length)return {...result301(s,"pending_verification",s.issues.join(" ")),citation:remedyCitations(s,20)};
  const matches=[["(b)","9903.88.01"],["(d)","9903.88.02"],["(f)","9903.88.03"],["(s)","9903.88.15"]].filter(([part])=>matchesCode(s.notes[20].lists[part],hts));
  if(matches.length!==1)return {...result301(s,"pending_verification",matches.length?"Conflicting current China-list scope matches require review.":"No supported current China-list scope match; absence from these four lists does not establish exemption."),citation:remedyCitations(s,20)};
  const digits=hts.replace(/\D/g,"");const currentMapping=s.chinaCoverage?.[digits]??s.chinaCoverage?.[digits.slice(0,8)];
  if(!currentMapping||currentMapping!==matches[0][1])return {...result301(s,"pending_verification","The fresh USITC China tariff reference and parsed legacy scope do not independently agree. A newer or unsupported measure needs verification."),citation:[...remedyCitations(s,20),"https://hts.usitc.gov/reststop/file?filename=China%20Tariffs&release=currentRelease"]};
  const heading=matches[0][1],row=s.headings.find(r=>r.htsno===heading);const rate=row?/^The duty provided in the applicable subheading (?:\+|plus) (\d+(?:\.\d+)?)%$/.exec(row.general.trim()):null;
  if(!rate)return {...result301(s,"pending_verification",`Current rate for ${heading} is missing or unrecognized.`),citation:remedyCitations(s,20)};
  return {...result301(s,"resolved",`Current Note 20 scope and published ${heading} supply this standard China-list rate. Product-specific exclusions are not claimed or assessed.`,heading,Number(rate[1])/100),citation:remedyCitations(s,20)};
}
