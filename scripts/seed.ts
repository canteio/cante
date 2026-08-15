import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../lib/db/client";
import { customerProfiles, customers, sources } from "../lib/db/schema";
import { SOURCE_REGISTRY } from "../lib/sources/registry";

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
          reliabilityStatus: source.reliabilityStatus,
          notes: source.notes ?? null,
        },
      })
      .run();
  }
  console.log(`Seeded ${SOURCE_REGISTRY.length} sources.`);

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
