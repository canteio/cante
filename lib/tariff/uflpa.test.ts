import assert from "node:assert/strict";
import test from "node:test";
import { lookupUflpaAdvisories, UFLPA_HIGH_PRIORITY_SECTORS, UFLPA_SCOPE_CAVEAT } from "@/lib/tariff/uflpa";

test("flags polysilicon (2804.61) from China as the silica-based high-priority sector", () => {
  const result = lookupUflpaAdvisories("2804.61.00.00", "CN");
  assert.equal(result.length, 1);
  assert.equal(result[0].sector, "Silica-based products, including polysilicon");
  assert.equal(result[0].determinesForcedLaborStatus, false);
  assert.ok(result[0].citation.includes("19 U.S.C. § 1307 note"));
  assert.ok(result[0].listedEntityExamples.join(" ").includes("Hoshine Silicon Industry"));
});

test("flags cotton (Chapter 52) from China as the cotton high-priority sector", () => {
  const result = lookupUflpaAdvisories("5208.11.40.00", "CN");
  assert.deepEqual(result.map((r) => r.sector), ["Cotton and cotton products"]);
  assert.ok(result[0].listedEntityExamples.join(" ").includes("Esquel"));
});

test("flags aluminum (Chapter 76) from China independent of Section 232/338 duty components", () => {
  const result = lookupUflpaAdvisories("7604.21.00.00", "CN");
  assert.deepEqual(result.map((r) => r.sector), ["Aluminum and aluminum products"]);
});

test("flags tomatoes (heading 2002) from China", () => {
  const result = lookupUflpaAdvisories("2002.90.80.00", "CN");
  assert.deepEqual(result.map((r) => r.sector), ["Tomatoes and tomato products"]);
});

test("flags PVC (heading 3904) from China", () => {
  const result = lookupUflpaAdvisories("3904.10.00.00", "CN");
  assert.deepEqual(result.map((r) => r.sector), ["Polyvinyl chloride (PVC)"]);
});

test("flags seafood (Chapter 3) from China", () => {
  const result = lookupUflpaAdvisories("0303.89.00.00", "CN");
  assert.deepEqual(result.map((r) => r.sector), ["Seafood"]);
});

test("does NOT flag a non-high-priority HTS code from China", () => {
  const result = lookupUflpaAdvisories("8544.42.90.00", "CN");
  assert.deepEqual(result, []);
});

test("does NOT flag a high-priority-sector HTS code when country of origin is not China", () => {
  const result = lookupUflpaAdvisories("2804.61.00.00", "MX");
  assert.deepEqual(result, []);
});

test("does NOT flag when country of origin is empty or malformed", () => {
  assert.deepEqual(lookupUflpaAdvisories("2804.61.00.00", ""), []);
  assert.deepEqual(lookupUflpaAdvisories("2804.61.00.00", "china"), []);
});

test("does NOT flag when the HTS code has no digits", () => {
  assert.deepEqual(lookupUflpaAdvisories("abc", "CN"), []);
});

test("PVC (3904) does not spuriously match the seafood sector's Chapter 3 prefix", () => {
  const result = lookupUflpaAdvisories("3904.10.00.00", "CN");
  assert.equal(result.some((r) => r.sector === "Seafood"), false);
});

test("every table entry carries citations tied to a specific named FLETF strategy document", () => {
  for (const entry of UFLPA_HIGH_PRIORITY_SECTORS) {
    assert.ok(entry.citation.length > 10);
    assert.ok(entry.htsPrefixes.length > 0);
    assert.ok(
      entry.citation.includes("2022") || entry.citation.includes("2024"),
      `citation for ${entry.sector} must name a specific dated FLETF strategy document, got: ${entry.citation}`,
    );
  }
});

test("PVC/aluminum/seafood cite the 2024 Updates, not the original 2022 Strategy", () => {
  const laterSectors = UFLPA_HIGH_PRIORITY_SECTORS.filter((e) =>
    ["Polyvinyl chloride (PVC)", "Aluminum and aluminum products", "Seafood"].includes(e.sector),
  );
  assert.equal(laterSectors.length, 3);
  for (const entry of laterSectors) {
    assert.ok(entry.citation.includes("2024 Updates"), `${entry.sector} must cite the 2024 Updates document`);
    assert.ok(!entry.citation.includes("at 8"), `${entry.sector} must not reuse the 2022 Strategy's page citation`);
  }
});

test("cotton/tomatoes/polysilicon cite the original June 17, 2022 Strategy", () => {
  const foundingSectors = UFLPA_HIGH_PRIORITY_SECTORS.filter((e) =>
    ["Cotton and cotton products", "Tomatoes and tomato products", "Silica-based products, including polysilicon"].includes(e.sector),
  );
  assert.equal(foundingSectors.length, 3);
  for (const entry of foundingSectors) {
    assert.ok(entry.citation.includes("June 17, 2022"), `${entry.sector} must cite the original 2022 Strategy`);
  }
});

test("Esquel entity example cites the correct Federal Register notice (89 FR 87391, not 89 FR 80588)", () => {
  const cotton = UFLPA_HIGH_PRIORITY_SECTORS.find((e) => e.sector === "Cotton and cotton products");
  const examples = cotton?.listedEntityExamples?.join(" ") ?? "";
  assert.ok(examples.includes("89 FR 87391"));
  assert.ok(!examples.includes("80588"));
});

test("exposes a non-empty scope caveat distinguishing the 2022 and 2024 strategy documents and naming later unmodeled sectors", () => {
  assert.ok(UFLPA_SCOPE_CAVEAT.includes("does not hold verified HTS mappings"));
  assert.ok(UFLPA_SCOPE_CAVEAT.includes("2024 Updates"));
  assert.ok(UFLPA_SCOPE_CAVEAT.toLowerCase().includes("steel"));
});
