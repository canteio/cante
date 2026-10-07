/** Re-sync periodically from USITC's China Tariffs PDF text extraction.
 * Usage: node --import tsx scripts/generate-section301-coverage.ts <extracted-text-path>
 * Review the generated diff and rate-table gaps before publishing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const input = process.argv[2];
if (!input) throw new Error("Pass the path to the USITC PDF text extraction.");
const text = readFileSync(input, "utf8");
const updated = text.match(/\(Last Updated ([^)]+)\)/)?.[1];
if (!updated) throw new Error("Missing USITC Last Updated date.");
const coverage: Record<string, string> = {};
let started = false;
for (const line of text.split(/\r?\n/)) {
  const match = line.trim().match(/^(\d{4}\.\d{2}\.\d{2}(?:\d{2})?)\s+(9903\.\d{2}\.\d{2})$/);
  if (!match) {
    if (started && line.trim()) throw new Error(`Unexpected data line: ${line}`);
    continue;
  }
  started = true;
  const key = match[1].replace(/\./g, "");
  if (coverage[key]) throw new Error(`Duplicate HTS code: ${match[1]}`);
  coverage[key] = match[2];
}
if (!started) throw new Error("No coverage rows found.");
const data = {
  sourceUrl: "https://hts.usitc.gov/reststop/file?filename=China%20Tariffs&release=currentRelease",
  lastUpdated: updated,
  sourceTextSha256: createHash("sha256").update(text).digest("hex"),
  limitation: "Generated snapshot; requires periodic re-sync. Coverage only, not rates or product-specific exclusions. Absence does not establish exemption.",
  coverage,
};
writeFileSync("lib/tariff/section301-coverage.json", JSON.stringify(data, null, 2) + "\n");
console.log(`Generated ${Object.keys(coverage).length} rows; Last Updated ${updated}.`);
