import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { parseShipmentExport, type MonitorRecall, WINDOW_DAYS } from "./model";

export class ShipmentSourceBlocked extends Error {}
export async function loadShipmentExport(file: string | undefined, now: string) {
  if (!file) throw new ShipmentSourceBlocked("No authorized shipment export configured; free automated shipment feed not established. Founder data-access decision pending.");
  if ((await stat(file)).size > 20_000_000) throw new Error("Shipment export exceeds 20 MB");
  return parseShipmentExport(await readFile(file, "utf8"), now);
}

const named = z.object({ Name: z.string().nullish() });
const recallSchema = z.object({
  RecallID: z.number().int(), RecallNumber: z.string().min(1),
  RecallDate: z.string().min(10), Title: z.string().min(1), URL: z.string().url(),
  Description: z.string().nullish(), Products: z.array(named).nullish(),
  Importers: z.array(named).nullish(),
});
export function parseMonitorRecalls(raw: unknown): MonitorRecall[] {
  // Unlike the existing alert adapter's 30-row cap, validate every row in the
  // bounded date window and retain importer names needed for identity matching.
  return z.array(recallSchema).max(10000).parse(raw).map(r => {
    if (!Number.isFinite(Date.parse(r.RecallDate))) throw new Error("CPSC returned an invalid recall date");
    const url = new URL(r.URL);
    if (url.protocol !== "https:" || !(url.hostname === "cpsc.gov" || url.hostname.endsWith(".cpsc.gov"))) throw new Error("Unexpected CPSC recall URL");
    return { id: String(r.RecallID), date: r.RecallDate.slice(0, 10),
      importers: (r.Importers ?? []).flatMap(i => i.Name ? [i.Name] : []),
      entry: { sourceId: "us-cpsc-recalls", sourceName: "CPSC recalls", domain: "www.cpsc.gov",
        regulationType: "standards", label: `CPSC recall ${r.RecallNumber}`,
        number: r.RecallNumber, year: Number(r.RecallDate.slice(0, 4)),
        listingTitle: r.Title, fullTitle: [r.Title, r.Description, ...(r.Products ?? []).map(p => p.Name)].filter(Boolean).join(". "),
        truncated: false, url: r.URL, foundInViews: ["cpsc-recalls"] },
    };
  });
}
export async function fetchMonitorRecalls(now: string, fetcher: typeof fetch = fetch) {
  const end = new Date(now);
  const start = new Date(end.getTime() - WINDOW_DAYS * 86400000);
  const url = new URL("https://www.saferproducts.gov/RestWebServices/Recall");
  url.searchParams.set("format", "json");
  url.searchParams.set("RecallDateStart", start.toISOString().slice(0, 10));
  url.searchParams.set("RecallDateEnd", end.toISOString().slice(0, 10));
  const response = await fetcher(url, { signal: AbortSignal.timeout(30000), headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`CPSC HTTP ${response.status}`);
  const raw = await response.text();
  if (raw.length > 20_000_000) throw new Error("CPSC response exceeds 20 MB");
  return parseMonitorRecalls(JSON.parse(raw));
}
