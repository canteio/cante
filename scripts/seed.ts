import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createServiceClient } from "../lib/supabase/service";
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
    status: "manual_assisted",
    notes:
      "The OSS KBLI catalogue-version API is automated, but company licensing status, risk level, and PB-UMKU applicability require confirmed KBLI/NIB evidence.",
  },
  {
    id: "id-national-uu",
    country: "Indonesia",
    jurisdiction: "national",
    name: "Undang-Undang (UU)",
    category: "national_law",
    status: "automated",
    notes: "JDIH Setneg JSON exhaustively polls the current and prior year; BPK remains manual because it is bot-blocked.",
  },
  {
    id: "id-national-pp",
    country: "Indonesia",
    jurisdiction: "national",
    name: "Peraturan Pemerintah (PP)",
    category: "national_law",
    status: "automated",
    notes: "JDIH Setneg JSON exhaustively polls the current and prior year with legal dates and official PDFs.",
  },
  {
    id: "id-national-perpres-kepres",
    country: "Indonesia",
    jurisdiction: "national",
    name: "Perpres / Kepres",
    category: "national_law",
    status: "automated",
    notes: "JDIH Setneg JSON covers Perpres and Keppres with pagination, legal dates, status, and official PDFs.",
  },
  {
    id: "id-national-permen-kepmen",
    country: "Indonesia",
    jurisdiction: "national",
    name: "Permen / Kepmen",
    category: "national_law",
    status: "manual_assisted",
    notes:
      "No reliable central all-ministry feed exists. Verified ministry JDIH adapters are automated and additional ministries must be selected from customer facts.",
  },
  {
    id: "id-national-perpu-inpres",
    country: "Indonesia",
    jurisdiction: "national",
    name: "Perpu and Inpres",
    category: "national_law",
    status: "automated",
    notes: "JDIH Setneg JSON covers Perpu and Inpres for the current and prior year.",
  },
  {
    id: "id-tax-customs",
    country: "Indonesia",
    jurisdiction: "national",
    name: "Kemenkeu, DJBC, and DJP tax-customs",
    category: "tax_customs",
    status: "automated",
    notes: "JDIH Kemenkeu, DJBC, and DJP sources monitor PMK, customs, duty, tariff, excise, and tax-administration changes.",
  },
  {
    id: "id-sni-bsn",
    country: "Indonesia",
    jurisdiction: "national",
    name: "BSN and mandatory SNI exposure",
    category: "sni",
    status: "manual_assisted",
    notes: "BSN PESTA catalogue changes are automated; mandatory applicability still needs product and sector-rule evidence.",
  },
  {
    id: "id-regional-east-java-surabaya",
    country: "Indonesia",
    jurisdiction: "East Java / Surabaya",
    name: "Perda and Perkada for factory location",
    category: "regional",
    status: "manual_assisted",
    notes: "Surabaya JDIH and DLH are automated by location; East Java provincial JDIH remains manual-assisted because Cloudflare blocks unattended requests.",
  },
  {
    id: "id-environment-klh",
    country: "Indonesia",
    jurisdiction: "national / Surabaya",
    name: "Environmental rules and public document notices",
    category: "environment",
    status: "automated",
    notes: "KLH/BPLH legal JSON plus location-activated Surabaya DLH AMDAL, UKL-UPL, DELH, and DPLH notices.",
  },
  {
    id: "id-labor-kemnaker",
    country: "Indonesia",
    jurisdiction: "national",
    name: "Labor and occupational safety rules",
    category: "labor_safety",
    status: "automated",
    notes: "JDIH Kemnaker newest-upload listing is monitored with stated legal dates preserved.",
  },
];

const US_SOURCE_PACKS = [
  ["us-federal-register", "national", "Federal Register manufacturing rules", "national_law", "automated"],
  ["us-ecfr", "national", "eCFR current rule changes", "national_law", "automated"],
  ["us-osha", "federal/state-plan", "OSHA workplace safety", "safety", "automated"],
  ["us-epa", "federal", "EPA TSCA, RCRA, air, water, and reporting", "environment", "automated"],
  ["us-ftc", "federal", "FTC labels, claims, and Made in USA", "labeling", "automated"],
  ["us-cpsc", "federal", "CPSC product safety and certificates", "product", "automated"],
  ["us-sector-products", "federal", "FDA, USDA, FCC, and DOT product-rule changes", "product", "automated"],
  ["us-nc-osh", "North Carolina", "North Carolina OSH", "regional", "automated"],
  ["us-nc-deq", "North Carolina", "North Carolina environmental and air notices", "regional", "automated"],
  ["us-mecklenburg-air", "Mecklenburg County", "Mecklenburg County air permit notices", "regional", "automated"],
  ["us-nc-tax", "North Carolina", "NCDOR tax notices and law-change guidance", "tax", "automated"],
  [
    "us-federal-tax-customs",
    "federal",
    "IRS rules, 26 CFR internal revenue, and 19 CFR customs duties including drawback",
    "tax",
    "automated",
  ],
  ["us-ca-register", "California", "California Regulatory Notice Register", "distribution", "automated"],
  ["us-ny-register", "New York", "New York State Register", "distribution", "automated"],
  ["us-tx-register", "Texas", "Texas Register", "distribution", "automated"],
  ["us-distribution", "distribution states", "State tax, EPR, PFAS, packaging, consumer, and product rules", "distribution", "manual_assisted"],
  ["us-bis-ear", "federal", "BIS EAR, CCL, ECCN, and license controls", "export", "automated"],
  ["us-census-aes", "federal", "Census FTR, AES, and EEI", "export", "automated"],
  ["us-ofac", "federal", "OFAC sanctions and party controls", "export", "automated"],
  ["us-ddtc-itar", "federal", "DDTC and ITAR exposure", "export", "manual_assisted"],
  ["us-cbp", "federal", "CBP customs and export enforcement", "export", "automated"],
  ["us-hts-rulings", "federal", "USITC HTS tariffs and CBP CROSS rulings", "customs", "automated"],
  ["us-trade-remedies", "federal", "Section 301, Section 232, AD/CVD, and import-injury actions", "trade", "automated"],
  ["us-forced-labor", "federal", "UFLPA entities and CBP WRO/Findings", "trade", "automated"],
  ["us-csl-screening", "federal", "Trade.gov consolidated restricted-party screening", "export", "automated"],
].map(([id, jurisdiction, name, category, status]) => ({
  id,
  country: "United States",
  jurisdiction,
  name,
  category,
  status,
  notes:
    status === "automated"
      ? "Backed by an official change feed or monitored official source; applicability still depends on customer facts."
      : "Coverage is represented in the checklist but requires location/product-specific official research or evidence.",
}));

function cloudError(scope: string, error: { message: string } | null) {
  if (error) throw new Error(`Supabase ${scope} failed: ${error.message}`);
}

/**
 * Seeds a fictional example customer and both jurisdiction source lists.
 *
 * The customer profile is read from the existing config/customer.json rather
 * than retyped, so the unconfirmed-HS-code flags carry over exactly as they
 * were recorded — nothing silently becomes "verified" by moving into a table.
 */
async function main() {
  const configPath = path.join(process.cwd(), "config", "customer.json");
  const config = JSON.parse(await readFile(configPath, "utf-8"));
  const supabase = createServiceClient();

  for (const source of SOURCE_REGISTRY) {
    const { error } = await supabase.from("sources").upsert({
      id: source.id,
      country: source.country,
      name: source.name,
      domain: source.domain,
      url: source.url,
      regulation_type: source.regulationType,
      reliability_status: source.reliabilityStatus,
      view: source.view ?? null,
      notes: source.notes ?? null,
    }, { onConflict: "id" });
    cloudError("sources seed", error);
  }
  console.log(`Seeded ${SOURCE_REGISTRY.length} sources.`);

  // Superseded by the instrument-specific Setneg and Permen/Kepmen packs.
  const { error: deleteError } = await supabase.from("source_packs").delete().eq("id", "id-national-law");
  cloudError("source pack cleanup", deleteError);

  for (const pack of [...INDONESIA_SOURCE_PACKS, ...US_SOURCE_PACKS]) {
    const { error } = await supabase.from("source_packs").upsert({
      id: pack.id,
      country: pack.country,
      jurisdiction: pack.jurisdiction,
      name: pack.name,
      category: pack.category,
      status: pack.status,
      notes: pack.notes,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
    cloudError("source pack seed", error);
  }
  console.log(
    `Seeded ${INDONESIA_SOURCE_PACKS.length} Indonesia and ${US_SOURCE_PACKS.length} United States source packs.`,
  );

  const { data: existing, error: existingError } = await supabase.from("customers").select("id, name");
  cloudError("customers read", existingError);
  if (existing && existing.length > 0) {
    await ensureUsProfiles(supabase, existing.map((customer) => customer.id as string));
    console.log(`Customers already present (${existing.map((c) => c.name).join(", ")}) — skipping.`);
    return;
  }

  const customerId = randomUUID();
  const c = config.customer;

  const { error: customerError } = await supabase.from("customers").insert({
    id: customerId, name: c.name, country: c.country, city: c.city,
  });
  cloudError("customer seed", customerError);

  const { error: profileError } = await supabase.from("customer_profiles").insert({
    id: randomUUID(),
    customer_id: customerId,
    product_description: c.product,
    business_type: "manufacturer",
    side_of_trade: c.side_of_trade,
    hs_codes: config.hs_codes.candidates.map((h: Record<string, unknown>) => ({
      code: h.code as string,
      basis: h.basis as string,
      confirmed: Boolean(h.confirmed),
    })),
    kbli_codes: [],
    destination_markets: config.destination_markets.countries ?? [],
    hs_codes_confirmed: Boolean(config.hs_codes.confirmed),
    destinations_confirmed: Boolean(config.destination_markets.confirmed),
    relevance_guidance: {
      likelyRelevant: config.relevance_guidance.likely_relevant,
      almostNeverRelevant: config.relevance_guidance.almost_never_relevant,
      note: config.relevance_guidance._note,
    },
  });
  cloudError("customer profile seed", profileError);

  await ensureUsProfiles(supabase, [customerId]);

  console.log(`Seeded customer ${c.name} (${customerId}).`);
  console.log(
    config.hs_codes.confirmed
      ? "HS codes marked confirmed."
      : "HS codes carried over as UNCONFIRMED — the judgment stage will disclose this.",
  );
}

async function ensureUsProfiles(
  supabase: ReturnType<typeof createServiceClient>,
  customerIds: string[],
): Promise<void> {
  const { data, error } = await supabase.from("jurisdiction_profiles").select("customer_id, country");
  cloudError("jurisdiction profiles read", error);
  const existing = new Set((data ?? []).map((row) => `${row.customer_id}:${row.country}`));
  for (const customerId of customerIds) {
    if (existing.has(`${customerId}:United States`)) continue;
    const { error: insertError } = await supabase.from("jurisdiction_profiles").insert({
      id: randomUUID(), customer_id: customerId, country: "United States",
    });
    cloudError("jurisdiction profile seed", insertError);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
