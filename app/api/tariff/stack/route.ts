import { computeStackedDuty } from "@/lib/tariff/stack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tariff-stacking calculator — the tool described almost verbatim by Kate
 * Chang (Toro Company) in customer-discovery: upload an HTS code + country
 * of origin, get the total stacked duty rate broken down by component, with
 * plain-English stacking logic and a Federal Register / Chapter 99 citation
 * for each applicable measure.
 *
 * This is additive to the existing /chat conversational interface, which is
 * untouched. `GET /api/tariff/stack?code=…&country=CN&value=10000` quotes a
 * single row; see lib/tariff/stack.ts for exactly what is and is not
 * computed yet (Section 232/USMCA/AD-CVD/UFLPA are explicitly flagged as
 * not-evaluated, never guessed).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const country = url.searchParams.get("country");
  const rawValue = url.searchParams.get("value");
  const value = rawValue === null ? null : Number(rawValue);
  const rawQuantity = url.searchParams.get("quantity");
  const quantity = rawQuantity === null ? null : Number(rawQuantity);
  const unit = url.searchParams.get("unit");
  const claimedProgramme = url.searchParams.get("programme");

  if (!code) {
    return Response.json({ error: "Provide code (HTS code)." }, { status: 400 });
  }
  if (!country) {
    return Response.json({ error: "Provide country (2-letter country of origin)." }, { status: 400 });
  }
  if (value !== null && !Number.isFinite(value)) {
    return Response.json({ error: "value must be a number." }, { status: 400 });
  }

  try {
    const result = await computeStackedDuty({
      htsCode: code,
      countryOfOrigin: country,
      value,
      quantity,
      unit,
      claimedProgramme,
    });
    if (!result) {
      return Response.json({ error: `No published HTS row matched ${code}.` }, { status: 404 });
    }
    return Response.json({ result });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Tariff stacking lookup failed." },
      { status: 500 },
    );
  }
}
