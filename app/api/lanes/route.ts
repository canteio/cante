import { resolveCustomerId } from "@/lib/db/queries";
import { deleteLane, importLanesCsv, listLanes, upsertLane } from "@/lib/catalogue/lanes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Trade lanes — item 3. */

export async function GET(request: Request) {
  const url = new URL(request.url);
  const customerId = await resolveCustomerId(url.searchParams.get("customerId"));
  if (!customerId) return Response.json({ lanes: [] });
  return Response.json({ lanes: listLanes(customerId) });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const payload = body as Record<string, unknown>;
  const customerId = await resolveCustomerId(payload.customerId as string | undefined);
  // Human/agent-fixable-error audit (final sweep): tell the caller exactly what
  // to pass instead of a bare "No customer." — matches products/suppliers/workqueue/etc.
  if (!customerId) {
    return Response.json(
      { error: "No customer could be resolved. Pass a valid `customerId` in the JSON request body, or omit it to use the default customer if one exists." },
      { status: 400 }
    );
  }

  if (typeof payload.csv === "string") {
    return Response.json({ summary: importLanesCsv(customerId, payload.csv) });
  }

  const originCountry = payload.originCountry as string;
  const destinationCountry = payload.destinationCountry as string;
  if (!originCountry || !destinationCountry) {
    return Response.json(
      { error: "originCountry and destinationCountry are required." },
      { status: 400 },
    );
  }

  const lane = upsertLane(
    customerId,
    {
      productId: (payload.productId as string) ?? null,
      direction: payload.direction as string,
      originCountry,
      destinationCountry,
      transitCountries: Array.isArray(payload.transitCountries)
        ? (payload.transitCountries as string[])
        : [],
      supplierId: (payload.supplierId as string) ?? null,
      brokerName: payload.brokerName as string | null,
      brokerContact: payload.brokerContact as string | null,
      incoterm: payload.incoterm as string | null,
      shipmentFrequency: payload.shipmentFrequency as string | null,
      annualShipments: typeof payload.annualShipments === "number" ? payload.annualShipments : null,
      annualValue: typeof payload.annualValue === "number" ? payload.annualValue : null,
      annualVolume: typeof payload.annualVolume === "number" ? payload.annualVolume : null,
      volumeUnit: payload.volumeUnit as string | null,
      currency: payload.currency as string | null,
      nextShipmentAt: payload.nextShipmentAt as string | null,
      notes: payload.notes as string | null,
    },
    (payload.laneId as string) ?? undefined,
  );

  return Response.json({ lane });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const customerId = await resolveCustomerId(url.searchParams.get("customerId"));
  const laneId = url.searchParams.get("laneId");
  if (!customerId || !laneId) {
    return Response.json({ error: "customerId and laneId are required." }, { status: 400 });
  }
  return Response.json({ deleted: deleteLane(customerId, laneId) });
}
