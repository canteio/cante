import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../lib/db/client";
import { customerProfiles, customers, sourcePacks, sources } from "../lib/db/schema";
import { SOURCE_REGISTRY } from "../lib/sources/registry";

const INDONESIA_SOURCE_PACKS = [
  {
    id: "id-trade-kemendag",
    country: "Indonesia",
    jurisdiction: "national",
    name: "Kemendag trade and export regulation",
    category: "trade",
    status: "automated",
    notes: "Backed by the current JDIH Kemendag fetcher across semua, ekspor, and perizinan views.",
  },
  {
    id: "id-kbli-oss",
    country: "Indonesia",
    jurisdiction: "national",
    name: "KBLI and OSS business licensing",
    category: "oss",
    status: "automated",
    notes: "OSS KBLI portal is monitored; specific obligation mapping requires confirmed KBLI evidence.",
  },
  {
    id: "id-national-uu",
    country: "Indonesia",
    jurisdiction: "national",
    name: "Undang-Undang (UU)",
    category: "national_law",
    status: "automated",
    notes: "peraturan.go.id UU surface is monitored; BPK remains manual because it is bot-blocked.",
  },
  {
    id: "id-national-pp",
    country: "Indonesia",
    jurisdiction: "national",
    name: "Peraturan Pemerintah (PP)",
    category: "national_law",
    status: "automated",
    notes: "peraturan.go.id PP surface is monitored and failures are recorded as coverage caveats.",
  },
  {
    id: "id-national-perpres-kepres",
    country: "Indonesia",
    jurisdiction: "national",
    name: "Perpres / Kepres",
    category: "national_law",
    status: "automated",
    notes: "peraturan.go.id Perpres surface is monitored; Kepres-class items are treated as presidential-rule coverage.",
  },
  {
    id: "id-national-permen-kepmen",
    country: "Indonesia",
    jurisdiction: "national",
    name: "Permen / Kepmen",
    category: "national_law",
    status: "automated",
    notes: "peraturan.go.id Permen surface plus ministry JDIH entries are monitored where reachable.",
  },
  {
    id: "id-tax-customs",
    country: "Indonesia",
    jurisdiction: "national",
    name: "Kemenkeu, DJBC, and DJP tax-customs",
    category: "tax_customs",
    status: "automated",
    notes: "JDIH Kemenkeu homepage is monitored for PMK/customs/duty/tax-administration changes.",
  },
  {
    id: "id-sni-bsn",
    country: "Indonesia",
    jurisdiction: "national",
    name: "BSN and mandatory SNI exposure",
    category: "sni",
    status: "automated",
    notes: "BSN PESTA product catalogue is monitored; mandatory applicability still needs product-specific judgment.",
  },
  {
    id: "id-regional-east-java-surabaya",
    country: "Indonesia",
    jurisdiction: "East Java / Surabaya",
    name: "Perda and Perkada for factory location",
    category: "regional",
    status: "manual_assisted",
    notes: "Initial customer is Surabaya. Regional JDIH discovery remains location-specific and manual-assisted until source paths are proven.",
  },
];

/**
 * Seeds MA and the Indonesian source list.
 *
 * The customer profile is read from the existing config/customer.json rather
 * than retyped, so the unconfirmed-HS-code flags carry over exactly as they
 * were recorded — nothing silently becomes "verified" by moving into a table.
 */
async function main() {
  const configPath = path.join(process.cwd(), "config", "customer.json");
  const config = JSON.parse(await readFile(configPath, "utf-8"));

  for (const source of SOURCE_REGISTRY) {
    db.insert(sources)
      .values({
        id: source.id,
        country: source.country,
        name: source.name,
        domain: source.domain,
        url: source.url,
        regulationType: source.regulationType,
        reliabilityStatus: source.reliabilityStatus,
        view: source.view ?? null,
        notes: source.notes ?? null,
      })
      .onConflictDoUpdate({
        target: sources.id,
        set: {
          name: source.name,
          domain: source.domain,
          url: source.url,
          regulationType: source.regulationType,
          reliabilityStatus: source.reliabilityStatus,
          view: source.view ?? null,
          notes: source.notes ?? null,
        },
      })
      .run();
  }
  console.log(`Seeded ${SOURCE_REGISTRY.length} sources.`);

  for (const pack of INDONESIA_SOURCE_PACKS) {
    db.insert(sourcePacks)
      .values(pack)
      .onConflictDoUpdate({
        target: sourcePacks.id,
        set: {
          country: pack.country,
          jurisdiction: pack.jurisdiction,
          name: pack.name,
          category: pack.category,
          status: pack.status,
          notes: pack.notes,
          updatedAt: new Date().toISOString(),
        },
      })
      .run();
  }
  console.log(`Seeded ${INDONESIA_SOURCE_PACKS.length} Indonesia source packs.`);

  const existing = db.select().from(customers).all();
  if (existing.length > 0) {
    console.log(`Customers already present (${existing.map((c) => c.name).join(", ")}) — skipping.`);
    return;
  }

  const customerId = randomUUID();
  const c = config.customer;

  db.insert(customers)
    .values({ id: customerId, name: c.name, country: c.country, city: c.city })
    .run();

  db.insert(customerProfiles)
    .values({
      id: randomUUID(),
      customerId,
      productDescription: c.product,
      businessType: "manufacturer",
      sideOfTrade: c.side_of_trade,
      hsCodes: config.hs_codes.candidates.map((h: Record<string, unknown>) => ({
        code: h.code as string,
        basis: h.basis as string,
        confirmed: Boolean(h.confirmed),
      })),
      kbliCodes: [],
      destinationMarkets: config.destination_markets.countries ?? [],
      hsCodesConfirmed: Boolean(config.hs_codes.confirmed),
      destinationsConfirmed: Boolean(config.destination_markets.confirmed),
      relevanceGuidance: {
        likelyRelevant: config.relevance_guidance.likely_relevant,
        almostNeverRelevant: config.relevance_guidance.almost_never_relevant,
        note: config.relevance_guidance._note,
      },
    })
    .run();

  console.log(`Seeded customer ${c.name} (${customerId}).`);
  console.log(
    config.hs_codes.confirmed
      ? "HS codes marked confirmed."
      : "HS codes carried over as UNCONFIRMED — the judgment stage will disclose this.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
