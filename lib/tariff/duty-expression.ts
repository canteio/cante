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

export const DUTY_CALCULATION_VERSION = "exact-duty-arithmetic-v2";

/** Expand the supplied numeric value's own decimal representation without
 * rounding or converting units. Decimal precision limits are checked by callers. */
function numberDecimal(value:number):string|null {
  if(!Number.isFinite(value)||value<0)return null;
  const [coefficient,exponent="0"]=value.toString().toLowerCase().split("e"),[whole,fraction=""]=coefficient.split("."),digits=whole+fraction,position=whole.length+Number(exponent);
  if(position< -320||position>320)return null;
  return position<=0?"0."+"0".repeat(-position)+digits:position>=digits.length?digits+"0".repeat(position-digits.length):digits.slice(0,position)+"."+digits.slice(position);
}

/** Only pure ad valorem charges can use this cap. It supplies no legal rule,
 * qualification or combined/specific-duty equivalence. Compare exact rationals. */
export function capAdValoremRate(raw:string,capFraction:string|number):string|null {
  const cap=typeof capFraction==="number"?numberDecimal(capFraction):capFraction;
  const decimal=(s:string)=>{if(s.length>30||!/^\d+(?:\.\d{1,12})?$/.test(s))return null;const[a,b=""]=s.split(".");return{n:BigInt(a+b),d:10n**BigInt(b.length)};};
  if(cap===null||raw.length>100)return null;const limit=decimal(cap);if(!limit||limit.n>limit.d)return null;
  const text=raw.trim();if(FREE.test(text))return raw;
  const pct=/^(\d+(?:\.\d{1,12})?)\s*%$/.exec(text),mixed=/^(\d{1,9}) (\d{1,9})\/(\d{1,9})%$/.exec(text);
  let rate:{n:bigint;d:bigint}|null=null;
  if(pct){const p=decimal(pct[1]);if(p)rate={n:p.n,d:p.d*100n};}
  else if(mixed){const[a,b,c]=mixed.slice(1).map(BigInt);if(c>0n&&b>0n&&b<c)rate={n:a*c+b,d:c*100n};}
  if(!rate)return null;if(rate.n*limit.d<=limit.n*rate.d)return raw;
  const numerator=limit.n*100n,whole=numerator/limit.d,scale=cap.split(".")[1]?.length??0,remainder=(numerator%limit.d).toString().padStart(scale,"0").replace(/0+$/,"");
  return whole.toString()+(remainder?"."+remainder:"")+"%";
}

function currencyNumber(cents:bigint):number|null {
  if(cents>BigInt(Number.MAX_SAFE_INTEGER)||cents< -BigInt(Number.MAX_SAFE_INTEGER))return null;
  const absolute=cents<0n?-cents:cents,text=(cents<0n?"-":"")+`${absolute/100n}.${String(absolute%100n).padStart(2,"0")}`,amount=Number(cents)/100;
  return Number.isFinite(amount)&&amount.toFixed(2)===text?amount:null;
}

/** Combine already-rounded monetary components using integer cents, preserving
 * the existing per-measure rounding policy. Optional subtraction is exact too. */
export function combineDutyAmounts(add:number[],subtract:number[]=[]):number|null {
  if(add.length+subtract.length>256)return null;
  let total=0n;for(const[values,sign]of [[add,1n],[subtract,-1n]] as const)for(const value of values){if(!Number.isFinite(value)||value<0)return null;const text=value.toFixed(2);if(!/^\d+\.\d{2}$/.test(text)||Number(text)!==value)return null;total+=BigInt(text.replace(".",""))*sign;}
  return currencyNumber(total);
}

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
  if(!rate.parsed)return{amount:null,currency:"USD",basis:[rate.note??`Duty rate "${rate.raw}" could not be parsed, so no duty was computed.`]};
  if(rate.free)return{amount:0,currency:"USD",basis:[`Rate is Free (${rate.raw}), so the duty is 0.`]};
  const value=input.value===null?null:numberDecimal(input.value),quantity=input.quantity==null?null:numberDecimal(input.quantity);
  if(rate.adValorem!==null&&value===null)return{amount:null,currency:"USD",basis:[`Rate ${rate.raw} is ad valorem but no valid shipment value is on file, so the duty cannot be computed.`]};
  if(rate.specificAmount!==null&&(!input.unit||input.unit.toLowerCase()!==rate.specificUnit||quantity===null))return{amount:null,currency:"USD",basis:[`Rate ${rate.raw} includes a per-${rate.specificUnit} charge, and no quantity in ${rate.specificUnit} is on file. Reporting only the ad valorem part would under-state the duty, so no figure is given.`]};
  // Column/qualification selection precedes this numeric adapter. Preserve its
  // existing programme-list syntax; the historical string API stays stricter.
  const raw=stripCountryList(rate.raw),exact=computeExactDuty(raw,{value,quantity,unit:input.unit});
  if(exact===null)return{amount:null,currency:"USD",basis:["The complete duty expression and supplied quantities could not be evaluated exactly; no partial amount is reported."]};
  const amount=currencyNumber(BigInt(exact.replace(".","")));
  if(amount===null)return{amount:null,currency:"USD",basis:["Duty arithmetic exceeds exact-cent numeric output bounds; amount withheld."]};
  const basis:string[]=[],av=raw.match(AD_VALOREM),sp=raw.match(SPECIFIC);
  if(av){const part=computeExactDuty(av[0],{value});basis.push(`Ad valorem: ${av[0]} × USD ${input.value!.toLocaleString()} = USD ${part}.`);}
  if(sp){const part=computeExactDuty(sp[0],{value,quantity,unit:input.unit});basis.push(`Specific: ${sp[0]} × ${input.quantity!.toLocaleString()} ${rate.specificUnit} = USD ${part}.`);}
  if(av&&sp)basis.push("Displayed parts are rounded; the complete compound duty is added exactly before one final cent rounding.");
  return{amount,currency:"USD",basis};
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

/** Exact decimal multiplication with half-up rounding to cents, including tiny values. */
export function computeAdValoremAmount(value:number,rate:number):number|null {
  if(!Number.isFinite(value)||!Number.isFinite(rate)||value<0||rate<0)return null;
  const decimal=(n:number)=>{const [coefficient,exponent="0"]=n.toString().toLowerCase().split("e");const [whole,fraction=""]=coefficient.split(".");const scale=fraction.length-Number(exponent);const numerator=BigInt(whole+fraction);return scale<0?{n:numerator*10n**BigInt(-scale),d:1n}:{n:numerator,d:10n**BigInt(scale)};};
  const a=decimal(value),b=decimal(rate);const numerator=a.n*b.n*100n,denominator=a.d*b.d;
  const rounded=(numerator*2n+denominator)/(denominator*2n);
  return currencyNumber(rounded);
}

/** Historical execution keeps decimal strings until the final cent. No network,
 * current-rate lookup or binary-float multiplication is used here. */
export function computeExactDuty(raw: string, input: { value: string | null; quantity?: string | null; unit?: string | null }): string | null {
  return computeExactDutySum([{raw,input}]);
}

/** Sum complete terms before rounding once. Distinct quantity units retain
 * their own inputs; a missing or unparsed term withholds the entire amount. */
export function computeExactDutySum(terms: {raw:string;input:{value:string|null;quantity?:string|null;unit?:string|null}}[]):string|null {
  if(!terms.length||terms.length>3)return null;
  const decimal = (s: string) => {
    if (!/^\d+(?:\.\d{1,12})?$/.test(s) || s.length > 30) throw Error("Invalid decimal");
    const [a,b=""] = s.split("."); return {n:BigInt(a+b),d:10n**BigInt(b.length)};
  };
  try {
    let n=0n,d=1n;
    const add = (a:bigint,b:bigint) => { n=n*b+a*d; d*=b; };
    for(const {raw,input}of terms){
    if(raw.length>100||/[()]/.test(raw))return null;
    // Published mixed fractional percentages retain their rational value. Never
    // turn 33 1/3% into a rounded decimal before calculating shipment money.
    const mixed=/^(\d{1,9}) (\d{1,9})\/(\d{1,9})%$/.exec(raw);
    if(mixed){if(input.value===null)return null;const whole=BigInt(mixed[1]),numerator=BigInt(mixed[2]),denominator=BigInt(mixed[3]);if(denominator<=0n||numerator<=0n||numerator>=denominator)return null;const v=decimal(input.value);add(v.n*(whole*denominator+numerator),v.d*denominator*100n);continue;}
    if(!parseDutyRate(raw).parsed)return null;
    const cleaned = stripCountryList(raw).trim(); if (FREE.test(cleaned)) continue;
    const av=cleaned.match(AD_VALOREM),sp=cleaned.match(SPECIFIC);
    if (av) { if(input.value===null)return null; const v=decimal(input.value),r=decimal(av[1]); add(v.n*r.n,v.d*r.d*100n); }
    if (sp) { if(!input.quantity||input.unit?.toLowerCase()!==sp[3].toLowerCase())return null; const q=decimal(input.quantity),r=decimal(sp[1]??sp[2]);add(q.n*r.n,q.d*r.d*(sp[1]?1n:100n)); }
    }
    const cents=(n*200n+d)/(d*2n); if(cents>100_000_000_000_000_000n)return null;
    return `${cents/100n}.${String(cents%100n).padStart(2,"0")}`;
  } catch { return null; }
}
