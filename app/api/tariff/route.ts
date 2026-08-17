import { compareDuty, lookupTariff, quoteDuty, TariffLookupError } from "@/lib/tariff/rates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Duty rates from the official USITC HTS schedule.
 *
 * `GET ?code=6306.12` returns the published row.
 * `GET ?code=…&value=400000` quotes the duty on a shipment.
 * `GET ?declared=…&expected=…&value=…` prices a misclassification.
 *
 * US import duty only. There is no Indonesian tariff schedule behind this, and
 * a US rate must never be presented as applying to an Indonesian movement.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const declared = url.searchParams.get("declared");
  const expected = url.searchParams.get("expected");
  const rawValue = url.searchParams.get("value");
  const value = rawValue === null ? null : Number(rawValue);
  const rawQuantity = url.searchParams.get("quantity");
  const quantity = rawQuantity === null ? null : Number(rawQuantity);
  const unit = url.searchParams.get("unit");

  if (value !== null && !Number.isFinite(value)) {
    return Response.json({ error: "value must be a number." }, { status: 400 });
  }

  try {
    if (declared && expected) {
      return Response.json(
        await compareDuty({ declaredCode: declared, expectedCode: expected, value, quantity, unit }),
      );
    }

    if (!code) {
      return Response.json(
        { error: "Provide code, or both declared and expected." },
        { status: 400 },
      );
    }

    if (value !== null) {
      const quote = await quoteDuty({
        htsCode: code,
        value,
        quantity,
        unit,
        claimedProgramme: url.searchParams.get("programme"),
      });
      if (!quote) {
        return Response.json({ error: `No published HTS row matched ${code}.` }, { status: 404 });
      }
      return Response.json({ quote });
    }

    const row = await lookupTariff(code);
    if (!row) return Response.json({ error: `No published HTS row matched ${code}.` }, { status: 404 });
    return Response.json({ row });
  } catch (error) {
    if (error instanceof TariffLookupError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "Tariff lookup failed." }, { status: 500 });
  }
}
