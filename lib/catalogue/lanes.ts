import type * as Schema from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { randomUUID } from "node:crypto";

import { type Supplier, type TradeLane } from "@/lib/db/schema";
import { parseCsv } from "@/lib/catalogue/csv";

/**
 * Trade lanes — item 3.
 *
 * A lane is what turns "Indonesia changed an export rule" into "this affects
 * your Chicago → Rotterdam movements", and it carries the only volume and
 * value figures the exposure maths in lib/impact has to work with.
 *
 * Frequency is stored as both a label and, where known, a shipment count. The
 * label is what customers say ("monthly"); the count is what arithmetic needs.
 * Deriving one from the other silently would invent precision, so
 * `annualShipments` stays null unless it was actually supplied or the label maps
 * to an unambiguous number.
 */

const FREQUENCY_TO_ANNUAL: Record<string, number> = {
  weekly: 52,
  fortnightly: 26,
  monthly: 12,
  quarterly: 4,
  annually: 1,
};

export interface LaneInput {
  productId?: string | null;
  direction?: string;
  originCountry: string;
  destinationCountry: string;
  transitCountries?: string[];
  supplierId?: string | null;
  brokerName?: string | null;
  brokerContact?: string | null;
  incoterm?: string | null;
  shipmentFrequency?: string | null;
  annualShipments?: number | null;
  annualValue?: number | null;
  annualVolume?: number | null;
  volumeUnit?: string | null;
  currency?: string | null;
  nextShipmentAt?: string | null;
  notes?: string | null;
}

export async function listLanes(customerId: string): Promise<TradeLane[]> {
  const supabase = await createClient();
  return cloudResult<Array<typeof Schema.tradeLanes.$inferSelect>>(
    await supabase
      .from("trade_lanes")
      .select("*")
      .eq("customer_id", customerId)
      .order("destination_country", { ascending: true }),
  );
}

export async function listLanesForProduct(customerId: string, productId: string): Promise<TradeLane[]> {
  // A lane with a null productId covers the whole catalogue, so it counts here.
  return (await listLanes(customerId)).filter((lane) => !lane.productId || lane.productId === productId);
}

/** Shipments a year, from the count if given, else from an unambiguous label. */
export function annualShipmentsOf(lane: TradeLane): number | null {
  if (lane.annualShipments && lane.annualShipments > 0) return lane.annualShipments;
  return FREQUENCY_TO_ANNUAL[lane.shipmentFrequency] ?? null;
}

function normaliseLane(customerId: string, input: LaneInput) {
  const now = new Date().toISOString();
  return {
    customerId,
    productId: input.productId ?? null,
    direction: input.direction === "import" ? "import" : "export",
    originCountry: input.originCountry.trim(),
    destinationCountry: input.destinationCountry.trim(),
    transitCountries: input.transitCountries ?? [],
    supplierId: input.supplierId ?? null,
    brokerName: input.brokerName?.trim() || null,
    brokerContact: input.brokerContact?.trim() || null,
    incoterm: input.incoterm?.trim() || null,
    shipmentFrequency: (input.shipmentFrequency || "unknown").toLowerCase(),
    annualShipments: input.annualShipments ?? null,
    annualValue: input.annualValue ?? null,
    annualVolume: input.annualVolume ?? null,
    volumeUnit: input.volumeUnit?.trim() || null,
    currency: (input.currency || "USD").toUpperCase(),
    nextShipmentAt: input.nextShipmentAt ?? null,
    notes: input.notes?.trim() || null,
    updatedAt: now,
  };
}

export async function upsertLane(customerId: string, input: LaneInput, laneId?: string): Promise<TradeLane> {
  const supabase = await createClient();
  const now = new Date().toISOString();
  const values = normaliseLane(customerId, input);

  if (laneId) {
    return cloudResult<TradeLane>(
      await supabase.from("trade_lanes").update(snakeRow(values))
        .eq("id", laneId).eq("customer_id", customerId).select("*").single(),
    );
  }

  const row = { id: randomUUID(), ...values, active: true, createdAt: now };
  cloudResult(
    await supabase
      .from("trade_lanes")
      .insert(snakeRow(row)),
  );
  return row as TradeLane;
}

export async function deleteLane(customerId: string, laneId: string): Promise<boolean> {
  const supabase = await createClient();
  const existing = (cloudResult<typeof Schema.tradeLanes.$inferSelect | null>(
    await supabase
      .from("trade_lanes")
      .select("*")
      .eq("customer_id", customerId)
      .eq("id", laneId)
      .limit(1)
      .maybeSingle(),
  ) ?? undefined);
  if (!existing) return false;
  cloudResult(
    await supabase
      .from("trade_lanes")
      .delete()
      .eq("id", laneId),
  );
  return true;
}

export async function upsertSupplier(
  customerId: string,
  input: { name: string; country?: string | null; address?: string | null; contactEmail?: string | null; role?: string | null; notes?: string | null; },
  supplierId?: string,
): Promise<Supplier> {
  const supabase = await createClient();
  const now = new Date().toISOString();
  const values = {
    customerId,
    name: input.name.trim(),
    country: input.country?.trim() || null,
    address: input.address?.trim() || null,
    contactEmail: input.contactEmail?.trim() || null,
    role: (input.role || "supplier").toLowerCase(),
    notes: input.notes?.trim() || null,
    updatedAt: now,
  };

  if (supplierId) {
    return cloudResult<Supplier>(
      await supabase.from("suppliers").update(snakeRow(values))
        .eq("id", supplierId).eq("customer_id", customerId).select("*").single(),
    );
  }

  const existing = (cloudResult<typeof Schema.suppliers.$inferSelect | null>(
    await supabase
      .from("suppliers")
      .select("*")
      .eq("customer_id", customerId)
      .eq("name", values.name)
      .limit(1)
      .maybeSingle(),
  ) ?? undefined);
  if (existing) {
    cloudResult(
      await supabase
        .from("suppliers")
        .update(snakeRow(values))
        .eq("id", existing.id),
    );
    return { ...existing, ...values };
  }

  const row = { id: randomUUID(), ...values, active: true, createdAt: now };
  cloudResult(
    await supabase
      .from("suppliers")
      .insert(snakeRow(row)),
  );
  return row as Supplier;
}

export async function listSuppliers(customerId: string): Promise<Supplier[]> {
  const supabase = await createClient();
  return cloudResult<Array<typeof Schema.suppliers.$inferSelect>>(
    await supabase
      .from("suppliers")
      .select("*")
      .eq("customer_id", customerId)
      .order("name", { ascending: true }),
  );
}

export interface LaneImportSummary {
  created: number;
  rejected: number;
  rows: Array<{ line: number; outcome: "created" | "rejected"; reason?: string; lane?: string; }>;
  caveats: string[];
}

/**
 * Import lanes from CSV. Supplier names are resolved to supplier rows, and SKUs
 * to products — an unknown SKU rejects the row rather than creating a lane that
 * points at nothing.
 */
export async function importLanesCsv(customerId: string, csv: string): Promise<LaneImportSummary> {
  const supabase = await createClient();
  const pending: Array<{ supplier_name: string; lane: ReturnType<typeof normaliseLane>; }> = [];
  const table = parseCsv(csv);
  const rows: LaneImportSummary["rows"] = [];
  const caveats: string[] = [];
  let created = 0;
  let rejected = 0;

  const pick = (row: Record<string, string>, ...names: string[]): string => {
    for (const name of names) if (row[name]) return row[name];
    return "";
  };

  for (const [index, row] of table.rows.entries()) {
    const line = index + 2;
    const origin = pick(row, "origin", "origin_country", "from");
    const destination = pick(row, "destination", "destination_country", "to");
    if (!origin || !destination) {
      rejected += 1;
      rows.push({ line, outcome: "rejected", reason: "Both an origin and a destination are required." });
      continue;
    }

    const sku = pick(row, "sku", "product_code", "item_code");
    let productId: string | null = null;
    if (sku) {
      const product = (cloudResult<typeof Schema.products.$inferSelect | null>(
        await supabase
          .from("products")
          .select("*")
          .eq("customer_id", customerId)
          .eq("sku", sku)
          .limit(1)
          .maybeSingle(),
      ) ?? undefined);
      if (!product) {
        rejected += 1;
        rows.push({
          line,
          outcome: "rejected",
          reason: `SKU "${sku}" is not in the catalogue. Import products before lanes.`,
        });
        continue;
      }
      productId = product.id;
    }

    const supplierName = pick(row, "supplier", "supplier_name", "vendor");

    const annualShipments = Number(pick(row, "annual_shipments", "shipments_per_year"));
    const annualValue = Number(pick(row, "annual_value", "value_per_year").replace(/[^\d.-]/g, ""));
    const annualVolume = Number(pick(row, "annual_volume", "volume_per_year").replace(/[^\d.-]/g, ""));

    const lane = normaliseLane(customerId, {
      productId,
      direction: pick(row, "direction") || "export",
      originCountry: origin,
      destinationCountry: destination,
      brokerName: pick(row, "broker", "broker_name"),
      incoterm: pick(row, "incoterm"),
      shipmentFrequency: pick(row, "frequency", "shipment_frequency"),
      annualShipments: Number.isFinite(annualShipments) && annualShipments > 0 ? annualShipments : null,
      annualValue: Number.isFinite(annualValue) && annualValue > 0 ? annualValue : null,
      annualVolume: Number.isFinite(annualVolume) && annualVolume > 0 ? annualVolume : null,
      volumeUnit: pick(row, "volume_unit", "uom"),
      currency: pick(row, "currency"),
      nextShipmentAt: pick(row, "next_shipment", "next_shipment_at") || null,
    });
    pending.push({ supplier_name: supplierName, lane });
    created += 1;
    rows.push({ line, outcome: "created", lane: `${origin} → ${destination}` });
  }
  if (pending.length) {
    cloudResult(
      await supabase
        .rpc("import_cante_lanes", {
          target_customer_id: customerId,
          entries: pending.map((item) => ({ ...item, lane: snakeRow(item.lane) })),
        }),
    );
  }

  if (created > 0) {
    caveats.push(
      "Lane volumes and values are as supplied by the customer. Every exposure estimate built on them inherits that, and none of it is verified against shipping records.",
    );
  }

  return { created, rejected, rows, caveats };
}

// Convert SQL column names only; JSON evidence keeps its original keys.
function camelRow<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((row) => camelRow(row)) as T;
  if (!value || typeof value !== "object") return value as T;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), item,
  ])) as T;
}
function snakeRow(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), item,
  ]));
}
function cloudResult<T = unknown>(result: { data?: unknown; error: { message: string; } | null; }): T {
  if (result.error) throw new Error(`Supabase operation failed: ${result.error.message}`);
  return camelRow<T>(result.data);
}
