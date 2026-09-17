import { z } from "zod";

// Suggestions stay separate from persisted facts until the customer reviews them.
export const WebsiteProfileSchema = z.object({
  legalName: z.string().trim().max(200),
  industry: z.string().trim().max(200),
  products: z.array(z.string().trim().min(1).max(200)).max(3),
  materialsChemicals: z.array(z.string().trim().min(1).max(200)).max(3),
}).strict();
export type WebsiteProfile = z.infer<typeof WebsiteProfileSchema>;

export function onboardingProfile(draft: WebsiteProfile) {
  const clean = (items: string[]) => [...new Set(items.map((item) => item.trim()).filter(Boolean))];
  return {
    legalName: draft.legalName.trim() || null,
    // Profile's products field already means “primary category, then products”.
    // Preserve free-text industry there instead of inventing a NAICS/KBLI code.
    products: clean([draft.industry, ...draft.products]),
    materialsChemicals: clean(draft.materialsChemicals),
  };
}

export function websiteUrl(raw: string): URL {
  const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      (url.port && !["80", "443"].includes(url.port))) throw new Error("Unsupported website URL");
  return url;
}

// Conservative public IPv4 allow-list boundary; IPv6-only sites use manual entry.
export function isPublicWebsiteAddress(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}
