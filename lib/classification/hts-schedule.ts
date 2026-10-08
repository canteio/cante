import { createHash } from "node:crypto";
import { load } from "cheerio";
import { z } from "zod";

const ExportRow = z.object({
  htsno: z.string(),
  indent: z.union([z.string(), z.number()]).transform(Number).pipe(z.number().int().nonnegative()),
  description: z.string(),
  general: z.string().default(""),
  special: z.string().default(""),
  other: z.string().default(""),
  additionalDuties: z.string().nullish(),
  units: z.array(z.string()).nullish().transform((v) => v ?? []),
  footnotes: z.array(z.unknown()).nullish().transform((v) => v ?? []),
});

export interface ScheduleLeaf {
  htsCode: string;
  chapter: string;
  indent: number;
  description: string;
  fullDescription: string;
  descriptionHash: string;
  general: string;
  special: string;
  other: string;
  additionalDuties: string;
  units: string[];
  footnotes: unknown[];
}

function plainText(value: string): string {
  return load(value, null, false).text().replace(/\s+/g, " ").trim();
}

/**
 * Preserve uncoded intermediate labels (often the only material/use context).
 * Statistical leaves inherit rates from their tariff-line parent. Siblings
 * must never inherit each other's descriptions or rates.
 */
export function flattenHtsChapter(payload: unknown, chapter: string): ScheduleLeaf[] {
  if (!/^(0[1-9]|[1-9][0-9])$/.test(chapter)) throw new Error("Invalid HTS chapter");
  const rows = z.array(ExportRow).parse(payload);
  const stack: z.infer<typeof ExportRow>[] = [];
  const found = new Map<string, ScheduleLeaf>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    while (stack.length && stack[stack.length - 1].indent >= row.indent) stack.pop();
    const code = row.htsno.trim();
    if (code && !code.replace(/\D/g, "").startsWith(chapter)) {
      throw new Error(`HTS export for chapter ${chapter} contains ${code}`);
    }
    stack.push(row);
    if (rows[i + 1] && rows[i + 1].indent > row.indent) continue;
    if (!/^(\d{4}\.\d{2}\.\d{2})(\.\d{2})?$/.test(code)) continue;
    const inherit = (key: "general" | "special" | "other" | "additionalDuties") =>
      plainText([...stack].reverse().find((parent) => parent[key]?.trim())?.[key] ?? "");
    const general = inherit("general");
    const special = inherit("special");
    const other = inherit("other");
    if (!general && !special && !other) continue;
    const fullDescription = stack.map((parent) => plainText(parent.description)).filter(Boolean).join(" > ");
    if (!fullDescription) throw new Error(`Missing description for ${code}`);
    if (found.has(code)) throw new Error(`Duplicate HTS leaf ${code}`);
    found.set(code, {
      htsCode: code, chapter, indent: row.indent,
      description: plainText(row.description), fullDescription,
      descriptionHash: createHash("sha256").update(fullDescription).digest("hex"),
      general, special, other, additionalDuties: inherit("additionalDuties"),
      units: [...stack].reverse().find((parent) => parent.units.length)?.units ?? [],
      footnotes: stack.flatMap((parent) => parent.footnotes),
    });
  }
  // Chapter 77 is reserved. An empty live chapter must not silently replace data.
  if (!found.size && chapter !== "77") throw new Error(`No rate-bearing HTS leaves in chapter ${chapter}`);
  return [...found.values()];
}
