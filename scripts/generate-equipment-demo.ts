import { mkdir, writeFile } from "node:fs/promises";
import { calculateDemo, catalogueCsv, historyCsv, demoReport, demoResultCsv } from "../components/tariff/demo-scenario";
async function main() {
  const dir = "public/examples/equipment-demo";
  await mkdir(dir, { recursive: true });
  const input = { catalogueCsv: catalogueCsv(), historyCsv: historyCsv(), regulationId: "sim-cn-25" };
  const result = calculateDemo(input);
  await Promise.all([
    writeFile(`${dir}/products.csv`, input.catalogueCsv), writeFile(`${dir}/imports.csv`, input.historyCsv),
    writeFile(`${dir}/expected-impact.csv`, demoResultCsv(result)), writeFile(`${dir}/scenario-report.md`, demoReport(result)),
  ]);
  console.log(JSON.stringify({ products: result.productCount, imports: result.history.rowCount, affected: result.affectedCount, extraAnnualDutyCents: result.totalExtraCents, topFive: result.topFive.map(r => ({ sku: r.sku, extraCents: r.extraCents })) }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
