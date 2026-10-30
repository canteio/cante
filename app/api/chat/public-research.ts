import { load } from "cheerio";

/** Public research has no model and receives no workspace/document context.
 * Only fixed public topic strings can leave the server; never echo a question,
 * product, private identifier, attachment, transcript or model-chosen URL. */
const topics = [
  { pattern: /\b(301|china|chinese)\b/i, term: "Section 301 China tariffs exclusions" },
  { pattern: /\b(232|steel|aluminum|metal)\b/i, term: "Section 232 steel aluminum tariffs" },
  { pattern: /\b(origin|transformation|manufactur\w*)\b/i, term: "customs country of origin substantial transformation" },
  { pattern: /\b(valu\w*|invoice|price|apprais\w*)\b/i, term: "customs valuation transaction value" },
  { pattern: /\b(hts|classif\w*)\b/i, term: "Harmonized Tariff Schedule classification" },
] as const;
export function publicResearchPlan(question: string) {
  if (/\b(without (?:research|search)|do not (?:research|search)|saved (?:catalogue|catalog|check|record))\b/i.test(question)) return null;
  if (!/\b(find|search|look up|latest|current|today|regulat\w*|tariff\w*|duties|compliance|cbp|ustr|customs)\b/i.test(question)) return null;
  const selected = topics.filter(t => t.pattern.test(question)).map(t => t.term).slice(0, 2);
  return { topics: selected.length ? selected : ["United States customs import tariff guidance"] };
}
const hosts = new Set(["www.federalregister.gov", "www.usitc.gov", "www.help.cbp.gov"]);
async function publicFetch(url: string, signal: AbortSignal) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || !hosts.has(parsed.hostname)) throw Error("Unsupported public source.");
  const response = await fetch(url, { redirect: "error", cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) });
  if (!response.ok || !response.body) throw Error(`Official source HTTP ${response.status}`);
  const parts: Uint8Array[] = []; let size = 0;
  const reader = response.body.getReader();
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 1500000) throw Error("Public source exceeds its limit."); parts.push(part.value); } }
  finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(parts, size).toString("utf8");
}
export type PublicResearch = { status: "fetched" | "partial" | "failed"; topics: string[]; sources: { title: string; url: string; text: string; publicationDate?: string | null }[]; failures: string[] };
export async function researchPublicGuidance(plan: NonNullable<ReturnType<typeof publicResearchPlan>>, signal: AbortSignal): Promise<PublicResearch> {
  // Revalidate plans at the network boundary, not just at their caller.
  const allowed = new Set<string>([...topics.map(t => t.term), "United States customs import tariff guidance"]);
  if (!plan.topics.length || plan.topics.length > 2 || plan.topics.some(t => !allowed.has(t))) throw Error("Use a fixed public research topic.");
  const sources: PublicResearch["sources"] = [], failures: string[] = [];
  for (const term of plan.topics) {
    const url = new URL("https://www.federalregister.gov/api/v1/documents.json");
    url.searchParams.set("conditions[term]", term); url.searchParams.set("order", "newest"); url.searchParams.set("per_page", "3");
    try {
      const data = JSON.parse(await publicFetch(url.toString(), signal));
      if (!Array.isArray(data.results)) throw Error("Unrecognized official response.");
      for (const doc of data.results.slice(0, 3)) if (typeof doc.html_url === "string" && doc.html_url.startsWith("https://www.federalregister.gov/documents/") && typeof doc.title === "string") sources.push({ title: doc.title.slice(0, 300), url: doc.html_url, publicationDate: doc.publication_date ?? null, text: String(doc.abstract ?? "No abstract supplied; full legal text was not read.").slice(0, 3000) });
    } catch { failures.push(`Federal Register lookup unavailable for ${term}.`); }
  }
  if (plan.topics.includes("customs valuation transaction value")) {
    for (const [url, title] of [["https://www.usitc.gov/faq/question/what_customs_value_and_how_it_computed.htm", "USITC: customs value"], ["https://www.help.cbp.gov/s/article/Article-1162?language=en_US", "CBP: commercial-invoice value"]]) {
      try { const $ = load(await publicFetch(url, signal)); $("script,style,nav,header,footer").remove(); const text = $("main").text() || $("body").text(); if (text.trim().length < 100) throw Error(); sources.push({ url, title, text: text.replace(/\s+/g, " ").trim().slice(0, 8000) }); }
      catch { failures.push(`${title} unavailable.`); }
    }
  }
  return { status: failures.length ? sources.length ? "partial" : "failed" : "fetched", topics: plan.topics, sources, failures };
}
