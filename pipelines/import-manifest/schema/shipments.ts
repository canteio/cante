/**
 * Drizzle schema for the US import-manifest pipeline (CBP AMS ocean data).
 *
 * Scope note: this table shape mirrors the public CBP CAMIR M01/P01/H01
 * record layout (see docs/import-data-pipeline.md) rather than any
 * reseller's product schema, because the underlying data is the same public
 * CBP source Volza/ImportGenius/Panjiva already resell.
 *
 * NOT yet wired into lib/db/schema.ts / drizzle migrations — this is a
 * standalone module so the pipeline can be developed and type-checked
 * independently before a real data source is confirmed (see FOIA path in
 * docs/import-data-pipeline.md). Once a data source is live, merge these
 * tables into lib/db/schema.ts and run `npm run db:push`.
 */
import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

/**
 * One row per inward ocean Cargo Declaration (CBP Form 1302) bill of lading.
 * Field names/lengths trace back to the CAMIR M01 (vessel), P01 (port), and
 * cargo-declaration record layouts documented in docs/import-data-pipeline.md.
 */
export const importShipments = sqliteTable("import_shipments", {
  id: text("id").primaryKey(),

  // Manifest identity
  billOfLading: text("bill_of_lading").notNull(),
  carrierScac: text("carrier_scac"), // Standard Carrier Alpha Code (M01)
  manifestSequenceNumber: text("manifest_sequence_number"),

  // Vessel (M01 record)
  vesselName: text("vessel_name"),
  vesselImoCode: text("vessel_imo_code"),
  voyageNumber: text("voyage_number"),

  // Ports (P01 record) — CBP Schedule D port codes
  portOfLadingCode: text("port_of_lading_code"),
  portOfUnladingCode: text("port_of_unlading_code"),

  // Parties — subject to 19 CFR 103.31(d) confidentiality redaction.
  // NULL here can mean "not yet ingested" OR "redacted at source" —
  // downstream code must not conflate the two. Use dataRedacted to
  // distinguish.
  shipperName: text("shipper_name"),
  shipperAddress: text("shipper_address"),
  consigneeName: text("consignee_name"),
  consigneeAddress: text("consignee_address"),
  dataRedacted: integer("data_redacted", { mode: "boolean" })
    .notNull()
    .default(false),

  // Cargo
  cargoDescription: text("cargo_description"),
  hsChapter: text("hs_chapter"), // 2-digit HS chapter, when derivable
  grossWeightKg: real("gross_weight_kg"),
  packageCount: integer("package_count"),
  containerNumbers: text("container_numbers", { mode: "json" }).$type<
    string[]
  >(),

  // Dates
  estimatedArrivalDate: text("estimated_arrival_date"),
  manifestFiledDate: text("manifest_filed_date"),

  // Provenance — every row must be traceable to how Cante got it.
  sourceType: text("source_type").notNull(), // e.g. "cbp_foia_bulk", "sample_fixture"
  sourceFileRef: text("source_file_ref"),
  ingestedAt: text("ingested_at").notNull().default(now),
});
