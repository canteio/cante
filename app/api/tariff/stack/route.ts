import { isStrictIsoDate } from "@/lib/tariff/date";
import {
  computeStackedDuty,
  type UsmcaQualificationDecision,
  type UsmcaQualificationInput,
} from "@/lib/tariff/stack";
import { TariffLookupError } from "@/lib/tariff/rates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tariff-stacking calculator — the tool described in customer discovery:
 * upload an HTS code + country of origin, get the total stacked duty rate
 * broken down by component, with plain-English stacking logic and a
 * Federal Register / Chapter 99 citation for each applicable measure.
 *
 * This is additive to the existing /chat conversational interface, which is
 * untouched. `GET /api/tariff/stack?code=…&country=CN&value=10000` quotes a
 * single row; see lib/tariff/stack.ts for exactly what is and is not
 * computed and which remain unresolved. Section 232 derivative amounts require
 * explicit content values, and USMCA preference requires an explicit verified
 * qualifying decision with supporting details.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const country = url.searchParams.get("country");
  const rawValue = url.searchParams.get("value");
  const value = rawValue === null || rawValue.trim() === "" ? null : Number(rawValue);
  const rawQuantity = url.searchParams.get("quantity");
  const quantity = rawQuantity === null || rawQuantity.trim() === "" ? null : Number(rawQuantity);
  const unit = url.searchParams.get("unit");
  const claimedProgramme = url.searchParams.get("programme");
  const importDate = url.searchParams.get("importDate");
  const rawSteelContentValue = url.searchParams.get("steelContentValue");
  const steelContentValue = rawSteelContentValue === null || rawSteelContentValue.trim() === ""
    ? null
    : Number(rawSteelContentValue);
  const rawAluminumContentValue = url.searchParams.get("aluminumContentValue");
  const aluminumContentValue = rawAluminumContentValue === null || rawAluminumContentValue.trim() === ""
    ? null
    : Number(rawAluminumContentValue);
  const rawUsmcaVerified = url.searchParams.get("usmcaVerified");
  const rawUsmcaDecision = url.searchParams.get("usmcaDecision");
  const usmcaDetails = url.searchParams.get("usmcaDetails");

  if (!code) {
    return Response.json({ error: "Provide code (HTS code)." }, { status: 400 });
  }
  if (!country) {
    return Response.json({ error: "Provide country (2-letter country of origin)." }, { status: 400 });
  }
  if (code.length > 64) {
    return Response.json({ error: "code must be 64 characters or fewer." }, { status: 400 });
  }
  if (!/^(?:\d{4}(?:\d{2}){0,3}|\d{4}(?:\.\d{2}){1,3})$/.test(code)) {
    return Response.json({ error: "Invalid HTS syntax." }, { status: 400 });
  }
  if (importDate !== null && !isStrictIsoDate(importDate)) {
    return Response.json({ error: "importDate must be a real YYYY-MM-DD date." }, { status: 400 });
  }
  if (unit !== null && unit.length > 32) {
    return Response.json({ error: "unit must be 32 characters or fewer." }, { status: 400 });
  }
  if (!/^[A-Za-z]{2}$/.test(country)) {
    return Response.json({ error: "country must be a 2-letter country-of-origin code." }, { status: 400 });
  }
  if (claimedProgramme !== null && claimedProgramme.length > 32) {
    return Response.json({ error: "programme must be 32 characters or fewer." }, { status: 400 });
  }
  if (usmcaDetails !== null && usmcaDetails.length > 2_000) {
    return Response.json({ error: "usmcaDetails must be 2000 characters or fewer." }, { status: 400 });
  }
  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    return Response.json({ error: "value must be a non-negative number." }, { status: 400 });
  }
  if (quantity !== null && (!Number.isFinite(quantity) || quantity < 0)) {
    return Response.json({ error: "quantity must be a non-negative number." }, { status: 400 });
  }
  if (steelContentValue !== null && (!Number.isFinite(steelContentValue) || steelContentValue < 0)) {
    return Response.json({ error: "steelContentValue must be a non-negative number." }, { status: 400 });
  }
  if (aluminumContentValue !== null && (!Number.isFinite(aluminumContentValue) || aluminumContentValue < 0)) {
    return Response.json({ error: "aluminumContentValue must be a non-negative number." }, { status: 400 });
  }
  if (
    value !== null &&
    ((steelContentValue !== null && steelContentValue > value) ||
      (aluminumContentValue !== null && aluminumContentValue > value) ||
      (steelContentValue ?? 0) + (aluminumContentValue ?? 0) > value)
  ) {
    return Response.json({ error: "Metal content values cannot individually or together exceed value." }, { status: 400 });
  }
  if (rawUsmcaVerified !== null && rawUsmcaVerified !== "true" && rawUsmcaVerified !== "false") {
    return Response.json({ error: "usmcaVerified must be true or false." }, { status: 400 });
  }
  let usmcaDecision: UsmcaQualificationDecision | null = null;
  if (rawUsmcaDecision !== null) {
    if (rawUsmcaDecision !== "qualifies" && rawUsmcaDecision !== "does_not_qualify") {
      return Response.json({ error: "usmcaDecision must be qualifies or does_not_qualify." }, { status: 400 });
    }
    usmcaDecision = rawUsmcaDecision;
  }
  const usmcaQualification: UsmcaQualificationInput | null =
    rawUsmcaVerified === null && rawUsmcaDecision === null && usmcaDetails === null
      ? null
      : {
          verified: rawUsmcaVerified === "true",
          decision: usmcaDecision,
          details: usmcaDetails,
        };

  try {
    const result = await computeStackedDuty({
      signal: request.signal,
      htsCode: code,
      countryOfOrigin: country,
      value,
      quantity,
      unit,
      claimedProgramme,
      importDate,
      steelContentValue,
      aluminumContentValue,
      usmcaQualification,
    });
    if (!result) {
      return Response.json({ error: `No published HTS row matched ${code}.` }, { status: 404 });
    }
    return Response.json({ result });
  } catch (error) {
    if (error instanceof TariffLookupError) {
      return Response.json({ error: "Tariff lookup unavailable." }, { status: 502 });
    }
    return Response.json({ error: "Tariff stacking lookup failed." }, { status: 500 });
  }
}
