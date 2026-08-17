import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { products, suppliers, tradeLanes, type Supplier, type TradeLane } from "@/lib/db/schema";
import { parseCsv } from "@/lib/catalogue/csv";

/**
 * Trade lanes — item 3.
 *
 * A lane is what turns "Indonesia changed an export rule" into "this affects
 * your Surabaya → Rotterdam movements", and it carries the only volume and
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

export function listLanes(customerId: string): TradeLane[] {
  return db
    .select()
    .from(tradeLanes)
    .where(eq(tradeLanes.customerId, customerId))
    .orderBy(asc(tradeLanes.destinationCountry))
    .all();
}

export function listLanesForProduct(customerId: string, productId: string): TradeLane[] {
  // A lane with a null productId covers the whole catalogue, so it counts here.
  return listLanes(customerId).filter((lane) => !lane.productId || lane.productId === productId);
}

/** Shipments a year, from the count if given, else from an unambiguous label. */
export function annualShipmentsOf(lane: TradeLane): number | null {
  if (lane.annualShipments && lane.annualShipments > 0) return lane.annualShipments;
  return FREQUENCY_TO_ANNUAL[lane.shipmentFrequency] ?? null;
}

export function upsertLane(customerId: string, input: LaneInput, laneId?: string): TradeLane {
  const now = new Date().toISOString();
  const values = {
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

  if (laneId) {
    db.update(tradeLanes).set(values).where(eq(tradeLanes.id, laneId)).run();
    return db.select().from(tradeLanes).where(eq(tradeLanes.id, laneId)).get() as TradeLane;
  }

  const row = { id: randomUUID(), ...values, active: true, createdAt: now };
  db.insert(tradeLanes).values(row).run();
  return row as TradeLane;
}

export function deleteLane(customerId: string, laneId: string): boolean {
  const existing = db
    .select()
    .from(tradeLanes)
    .where(and(eq(tradeLanes.customerId, customerId), eq(tradeLanes.id, laneId)))
    .get();
  if (!existing) return false;
  db.delete(tradeLanes).where(eq(tradeLanes.id, laneId)).run();
  return true;
}

export function upsertSupplier(
  customerId: string,
  input: { name: string; country?: string | null; address?: string | null; contactEmail?: string | null; role?: string | null; notes?: string | null },
  supplierId?: string,
): Supplier {
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
    db.update(suppliers).set(values).where(eq(suppliers.id, supplierId)).run();
    return db.select().from(suppliers).where(eq(suppliers.id, supplierId)).get() as Supplier;
  }

  const existing = db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.customerId, customerId), eq(suppliers.name, values.name)))
    .get();
  if (existing) {
    db.update(suppliers).set(values).where(eq(suppliers.id, existing.id)).run();
    return { ...existing, ...values };
  }

  const row = { id: randomUUID(), ...values, active: true, createdAt: now };
  db.insert(suppliers).values(row).run();
  return row as Supplier;
}

export function listSuppliers(customerId: string): Supplier[] {
  return db
    .select()
    .from(suppliers)
    .where(eq(suppliers.customerId, customerId))
    .orderBy(asc(suppliers.name))
    .all();
}

export interface LaneImportSummary {
  created: number;
  rejected: number;
  rows: Array<{ line: number; outcome: "created" | "rejected"; reason?: string; lane?: string }>;
  caveats: string[];
}

/**
 * Import lanes from CSV. Supplier names are resolved to supplier rows, and SKUs
 * to products — an unknown SKU rejects the row rather than creating a lane that
 * points at nothing.
 */
export function importLanesCsv(customerId: string, csv: string): LaneImportSummary {
  const table = parseCsv(csv);
  const rows: LaneImportSummary["rows"] = [];
  const caveats: string[] = [];
  let created = 0;
  let rejected = 0;

  const pick = (row: Record<string, string>, ...names: string[]): string => {
    for (const name of names) if (row[name]) return row[name];
    return "";
  };

  db.transaction(() => {
    table.rows.forEach((row, index) => {
      const line = index + 2;
      const origin = pick(row, "origin", "origin_country", "from");
      const destination = pick(row, "destination", "destination_country", "to");
      if (!origin || !destination) {
        rejected += 1;
        rows.push({ line, outcome: "rejected", reason: "Both an origin and a destination are required." });
        return;
      }

      const sku = pick(row, "sku", "product_code", "item_code");
      let productId: string | null = null;
      if (sku) {
        const product = db
          .select()
          .from(products)
          .where(and(eq(products.customerId, customerId), eq(products.sku, sku)))
          .get();
        if (!product) {
          rejected += 1;
          rows.push({
            line,
            outcome: "rejected",
            reason: `SKU "${sku}" is not in the catalogue. Import products before lanes.`,
          });
          return;
        }
        productId = product.id;
      }

      const supplierName = pick(row, "supplier", "supplier_name", "vendor");
      const supplierId = supplierName ? upsertSupplier(customerId, { name: supplierName }).id : null;

      const annualShipments = Number(pick(row, "annual_shipments", "shipments_per_year"));
      const annualValue = Number(pick(row, "annual_value", "value_per_year").replace(/[^\d.-]/g, ""));
      const annualVolume = Number(pick(row, "annual_volume", "volume_per_year").replace(/[^\d.-]/g, ""));

      upsertLane(customerId, {
        productId,
        direction: pick(row, "direction") || "export",
        originCountry: origin,
        destinationCountry: destination,
        supplierId,
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
      created += 1;
      rows.push({ line, outcome: "created", lane: `${origin} → ${destination}` });
    });
  });

  if (created > 0) {
    caveats.push(
      "Lane volumes and values are as supplied by the customer. Every exposure estimate built on them inherits that, and none of it is verified against shipping records.",
    );
  }

  return { created, rejected, rows, caveats };
}
