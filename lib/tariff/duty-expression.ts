/**
 * Parsing HTS duty-rate expressions.
 *
 * The USITC returns rates as human strings: `"Free"`, `"8.8%"`, `"2.5¢/kg"`,
 * `"4.4¢/kg + 8.5%"`, `"Free (AU,BH,CL,...)"`. Everything downstream that
 * claims to compute money depends on reading these correctly, so this file is
 * deliberately strict about one thing:
 *
 * **A rate this parser does not fully understand is `parsed: false`, never a
 * partial number.** The dangerous failure is a compound rate like
 * `"4.4¢/kg + 8.5%"` being read as "8.5%" — that silently under-states the duty
 * and produces a confident, wrong figure. A compound rate is only computable
 * when the caller can supply a quantity in the matching unit; otherwise the
 * honest answer is that it cannot be computed, which is what rule 2 demands of
 * arithmetic just as much as of coverage.
 */

export interface DutyRate {
  /** The original string, always retained so a human can check the maths. */
  raw: string;
  /** Fraction, not percent: 8.8% → 0.088. Null when the rate has no ad valorem part. */
  adValorem: number | null;
  /** Currency amount per unit, e.g. 2.5¢/kg → 0.025 (USD) with unit "kg". */
  specificAmount: number | null;
  specificUnit: string | null;
  /** True for an explicit "Free". Distinct from a 0% we failed to read. */
  free: boolean;
  /**
   * False when any part of the expression was not understood. A false here
   * must stop the caller from producing a figure.
   */
  parsed: boolean;
  /** Why parsing failed, for the caveat line. */
  note?: string;
}

const FREE = /^free$/i;
const AD_VALOREM = /(\d+(?:\.\d+)?)\s*%/;
/** Cents or dollars per unit: 2.5¢/kg, 1.2 cents/kg, $1.50/kg, 0.5c/liter. */
const SPECIFIC = /(?:\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:¢|c\b|cents?))\s*(?:\/|\s+per\s+)\s*([a-z0-9²³]+)/i;

/** Strip the trailing FTA country list: "Free (AU,BH,CL)" → "Free". */
function stripCountryList(value: string): string {
  return value.replace(/\([^)]*\)/g, "").trim();
}

export function parseDutyRate(raw: string | null | undefined): DutyRate {
  const original = (raw ?? "").trim();
  const base: DutyRate = {
    raw: original,
    adValorem: null,
    specificAmount: null,
    specificUnit: null,
    free: false,
    parsed: false,
  };

  if (!original) return { ...base, note: "No duty rate was published for this row." };

  const cleaned = stripCountryList(original);
  if (FREE.test(cleaned)) return { ...base, free: true, parsed: true };

  // A cross-reference to another heading is not a rate we can evaluate.
  if (/see\s+\d{4}/i.test(cleaned)) {
    return {
      ...base,
      note: `Rate "${original}" cross-references another heading and was not evaluated.`,
    };
  }

  const adValoremMatch = cleaned.match(AD_VALOREM);
  const specificMatch = cleaned.match(SPECIFIC);

  // Round at parse time. 8.8 / 100 is 0.08800000000000001 in binary floating
  // point, and that noise would otherwise ride into every duty figure and every
  // exposure total downstream. Published rates never carry more precision than
  // this, so rounding here loses nothing real.
  const round = (value: number) => Number(value.toFixed(8));

  const adValorem = adValoremMatch ? round(Number(adValoremMatch[1]) / 100) : null;
  let specificAmount: number | null = null;
  let specificUnit: string | null = null;
  if (specificMatch) {
    specificAmount = specificMatch[1]
      ? round(Number(specificMatch[1])) // "$1.50/kg" — already dollars
      : round(Number(specificMatch[2]) / 100); // "2.5¢/kg" — cents
    specificUnit = specificMatch[3].toLowerCase();
  }

  if (adValorem === null && specificAmount === null) {
    return { ...base, note: `Duty rate "${original}" was not in a recognised form.` };
  }

  // Everything the expression contains must be accounted for. If stripping the
  // parts we understood leaves arithmetic behind, we did not understand it.
  let residue = cleaned;
  if (adValoremMatch) residue = residue.replace(adValoremMatch[0], "");
  if (specificMatch) residue = residue.replace(specificMatch[0], "");
  residue = residue.replace(/[+,\s]/g, "");
  if (residue.length > 0) {
    return {
      ...base,
      adValorem,
      specificAmount,
      specificUnit,
      note: `Duty rate "${original}" has a component ("${residue}") this parser does not understand, so it was not used.`,
    };
  }

  return { ...base, adValorem, specificAmount, specificUnit, parsed: true };
}

export interface DutyComputation {
  /** Null whenever the rate could not be fully applied. Never a partial figure. */
  amount: number | null;
  currency: "USD";
  /** Every step, printed with the number. */
  basis: string[];
}

/**
 * Apply a rate to a shipment value (and quantity, when the rate needs one).
 *
 * Returns `amount: null` rather than an under-stated figure whenever a
 * specific (per-unit) component exists and no quantity in the matching unit
 * was supplied. Half a compound rate is not a duty estimate.
 */
export function computeDuty(
  rate: DutyRate,
  input: { value: number | null; quantity?: number | null; unit?: string | null },
): DutyComputation {
  const basis: string[] = [];

  if (!rate.parsed) {
    return {
      amount: null,
      currency: "USD",
      basis: [rate.note ?? `Duty rate "${rate.raw}" could not be parsed, so no duty was computed.`],
    };
  }

  if (rate.free) {
    basis.push(`Rate is Free (${rate.raw}), so the duty is 0.`);
    return { amount: 0, currency: "USD", basis };
  }

  let total = 0;

  if (rate.adValorem !== null) {
    if (input.value === null) {
      return {
        amount: null,
        currency: "USD",
        basis: [
          `Rate ${rate.raw} is ad valorem but no shipment value is on file, so the duty cannot be computed.`,
        ],
      };
    }
    const part = input.value * rate.adValorem;
    total += part;
    basis.push(
      `Ad valorem: ${(rate.adValorem * 100).toFixed(2)}% × USD ${input.value.toLocaleString()} = USD ${part.toFixed(2)}.`,
    );
  }

  if (rate.specificAmount !== null) {
    const unitMatches =
      input.unit && rate.specificUnit && input.unit.toLowerCase() === rate.specificUnit;
    if (!unitMatches || input.quantity === null || input.quantity === undefined) {
      return {
        amount: null,
        currency: "USD",
        basis: [
          `Rate ${rate.raw} includes a per-${rate.specificUnit} charge, and no quantity in ${rate.specificUnit} is on file. ` +
            "Reporting only the ad valorem part would under-state the duty, so no figure is given.",
        ],
      };
    }
    const part = input.quantity * rate.specificAmount;
    total += part;
    basis.push(
      `Specific: USD ${rate.specificAmount.toFixed(4)}/${rate.specificUnit} × ${input.quantity.toLocaleString()} ${rate.specificUnit} = USD ${part.toFixed(2)}.`,
    );
  }

  if (!Number.isFinite(total)) return { amount: null, currency: "USD", basis: ["Duty arithmetic overflow; amount withheld."] };
  return { amount: Number(total.toFixed(2)), currency: "USD", basis };
}

/**
 * FTA country codes named in a `special` rate string.
 *
 * `"Free (AU,BH, CL,CO,IL,JO,KR, MA,OM,P, PA,PE,S,SG)"` → the listed codes.
 * These are HTS special-programme symbols, not ISO country codes — `P` is
 * CAFTA-DR, `S` is USMCA — so they are returned verbatim for a human to read
 * rather than mapped to countries, which would invent precision.
 */
export function specialProgrammeCodes(special: string | null | undefined): string[] {
  if (!special) return [];
  const inner = special.match(/\(([^)]*)\)/)?.[1];
  if (!inner) return [];
  return inner
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);
}
