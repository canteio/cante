export const SUPPORTED_JURISDICTIONS = [
  {
    code: "ID",
    name: "Indonesia",
    shortName: "Indonesia",
    flag: "ID",
    description: "KBLI, OSS, SNI, national law, tax/customs, and regional rules",
  },
  {
    code: "US",
    name: "United States",
    shortName: "United States",
    flag: "US",
    description: "Manufacturing, distribution, state/local, and export compliance",
  },
] as const;

export type JurisdictionName = (typeof SUPPORTED_JURISDICTIONS)[number]["name"];

export const DEFAULT_JURISDICTION: JurisdictionName = "Indonesia";

export function normalizeJurisdiction(value: unknown): JurisdictionName {
  if (typeof value !== "string") return DEFAULT_JURISDICTION;
  const normalized = value.trim().toLowerCase();
  if (["us", "usa", "united states", "united states of america"].includes(normalized)) {
    return "United States";
  }
  return "Indonesia";
}

export function jurisdictionCode(name: JurisdictionName): "ID" | "US" {
  return name === "United States" ? "US" : "ID";
}
