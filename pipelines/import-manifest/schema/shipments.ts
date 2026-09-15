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
import { sql, type InferSelectModel } from "drizzle-orm";
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
  // First-class queryable field (added 2026-09-14, "foreign-shipper mirror"
  // sub-feature). China and Indonesia do NOT publish company-level customs
  // data themselves (GACC only releases enterprise-TYPE aggregates; no
  // Indonesian official portal exists at all — see docs/import-data-pipeline.md
  // "International customs data legal landscape"). The only LEGAL way to
  // surface a Chinese/Indonesian company's name is as the foreign shipper on
  // a US inward manifest — that disclosure is squarely covered by the same
  // 19 CFR 103.31(a)(3) public-release rule as the rest of this table. We
  // derive this from shipperAddress (see deriveShipperCountryCode in
  // fetch/fetch-manifests.ts) so it can be indexed/filtered directly instead
  // of requiring every caller to re-parse the free-text address, e.g.
  // Marketing querying "Chinese companies shipping X into the US" becomes a
  // plain `WHERE shipper_country_code = 'CN'` instead of a LIKE scan.
  shipperCountryCode: text("shipper_country_code"), // ISO 3166-1 alpha-2, e.g. "CN", "ID"
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

/**
 * Row type inferred from the table definition above. Exported so downstream
 * pure-logic modules (e.g. search/search-shipments.ts, step 3 of the
 * Volza-replacement build sequence) can type against real shipment shape
 * without importing Drizzle's table object itself or depending on a live
 * DB connection — keeps those modules unit-testable with plain fixture
 * arrays, same posture as match/match-shipment-recalls.ts.
 */
export type ImportShipmentRow = InferSelectModel<typeof importShipments>;
