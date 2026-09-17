import { load } from "cheerio";

// Keep HTML parsing on the server; the wizard imports only the draft schema.
export function websiteText(html: string): string {
  const $ = load(html);
  $("script, style, noscript, template, svg, [hidden], [aria-hidden=true]").remove();
  $("p, div, section, li, h1, h2, h3, br").append(" ");
  return $("body").text().replace(/\s+/g, " ").trim().slice(0, 12_000);
}

