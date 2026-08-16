import type { CustomerProfile, Memory } from "@/lib/db/schema";

/**
 * One place that decides what is *established* about a customer, so the
 * judgment stage can never be handed two contradictory answers.
 *
 * The contradiction this exists to kill: `customer_profiles.hsCodes` holds the
 * seed-time educated guesses, while `memories` can hold specific codes a human
 * confirmed on the Memory page. Rendering both as equals produced a prompt that
 * asserted 6306.19.90 and 3921.90 in the same breath.
 *
 * Three tiers, and they are not the same thing:
 *   document — off a real PEB/invoice. This is what `hsCodesConfirmed` means,
 *              and it is the only tier that may be called verified.
 *   human    — a person clicked confirm in Memory. Better than a guess, still
 *              not checked against an export document.
 *   guess    — seeded from the product description. Superseded the moment a
 *              human tier exists, and then must not be used or repeated.
 */

export type HsCodeTier = "document" | "human" | "lead" | "guess";

export interface ResolvedHsCode {
  code: string;
  basis: string;
  tier: HsCodeTier;
}

export interface ResolvedHsCodes {
  /** True only when the codes came off a real export document. */
  documentVerified: boolean;
  document: ResolvedHsCode[];
  human: ResolvedHsCode[];
  leads: ResolvedHsCode[];
  guesses: ResolvedHsCode[];
  /** Guesses are superseded once a document or human code exists. */
  guessesSuperseded: boolean;
}

const HS_CODE_RE = /\b\d{4}\s*\.\s*\d{2}(?:\s*\.\s*\d{2})?\b/g;
const KBLI_CODE_RE = /\b\d{5}\b/g;

function normaliseCode(raw: string): string {
  return raw.replace(/\s+/g, "");
}

function isHsMemory(memory: Memory): boolean {
  return memory.kind === "hs_code" || /\bhs\s*code\b|\bkode\s*hs\b/i.test(memory.content);
}

/** Codes stated in a memory row, with the row's own text as the basis. */
function hsFromMemories(rows: Memory[], tier: HsCodeTier): ResolvedHsCode[] {
  const out: ResolvedHsCode[] = [];
  const seen = new Set<string>();

  for (const memory of rows) {
    if (!isHsMemory(memory)) continue;
    for (const match of memory.content.match(HS_CODE_RE) ?? []) {
      const code = normaliseCode(match);
      if (seen.has(code)) continue;
      seen.add(code);
      out.push({
        code,
        basis: `${memory.content}${memory.source ? ` (source: ${memory.source})` : ""}`,
        tier,
      });
    }
  }

  return out;
}

export function resolveHsCodes(profile: CustomerProfile, memoryRows: Memory[]): ResolvedHsCodes {
  const confirmedRows = memoryRows.filter((m) => m.confirmed);
  const unconfirmedRows = memoryRows.filter((m) => !m.confirmed);

  const human = hsFromMemories(confirmedRows, "human");
  const humanCodes = new Set(human.map((h) => h.code));
  const leads = hsFromMemories(unconfirmedRows, "lead").filter((h) => !humanCodes.has(h.code));

  const profileCodes = profile.hsCodes.map((h) => ({
    code: normaliseCode(h.code),
    basis: h.basis,
    tier: (profile.hsCodesConfirmed || h.confirmed ? "document" : "guess") as HsCodeTier,
  }));

  const document = profileCodes.filter((h) => h.tier === "document");
  const guesses = profileCodes.filter((h) => h.tier === "guess" && !humanCodes.has(h.code));

  return {
    documentVerified: document.length > 0,
    document,
    human,
    leads,
    guesses,
    guessesSuperseded: document.length > 0 || human.length > 0,
  };
}

/**
 * The HS block the judgment prompt renders. Deliberately verbose about what
 * each tier is worth — this text is the only thing stopping the model from
 * treating a website-sourced code as an export-document fact.
 */
export function renderHsCodesForPrompt(resolved: ResolvedHsCodes): string {
  const list = (codes: ResolvedHsCode[]) =>
    codes.map((c) => `  - ${c.code} — ${c.basis}`).join("\n");

  const parts: string[] = ["## HS codes"];

  if (resolved.document.length) {
    parts.push(
      `Document-verified — read off a real export document (PEB/invoice). Treat as fact:\n${list(resolved.document)}`,
    );
  } else {
    parts.push(
      "Document-verified: NONE. No HS code has ever been checked against a real export " +
        "document, and every alert must disclose that.",
    );
  }

  if (resolved.human.length) {
    parts.push(
      "Human-confirmed in Memory — a person confirmed these, but they have NOT been checked " +
        "against an export document. Use them as the working codes, and say they are " +
        `unverified against shipping paperwork:\n${list(resolved.human)}`,
    );
  }

  if (resolved.leads.length) {
    parts.push(
      "Unconfirmed leads from chat — nobody has verified these. Never present one as a " +
        `checked fact:\n${list(resolved.leads)}`,
    );
  }

  if (resolved.guesses.length) {
    parts.push(
      resolved.guessesSuperseded
        ? "SUPERSEDED seed-time guesses — the confirmed codes above replace these. Do not " +
            `judge against them and do not repeat them to the customer:\n${list(resolved.guesses)}`
        : `Seed-time educated guesses, never verified by anyone:\n${list(resolved.guesses)}`,
    );
  }

  return parts.join("\n\n");
}

export interface ResolvedKbli {
  confirmed: string[];
  leads: string[];
}

/** KBLI codes from the profile plus anything memory has learned since. */
export function resolveKbliCodes(profile: CustomerProfile, memoryRows: Memory[]): ResolvedKbli {
  const confirmed = new Set<string>(profile.kbliCodes ?? []);
  const leads = new Set<string>();

  for (const memory of memoryRows) {
    if (memory.kind !== "kbli" && !/\b(kbli|oss|nib)\b/i.test(memory.content)) continue;
    for (const code of memory.content.match(KBLI_CODE_RE) ?? []) {
      if (memory.confirmed) confirmed.add(code);
      else if (!confirmed.has(code)) leads.add(code);
    }
  }

  for (const code of confirmed) leads.delete(code);
  return { confirmed: [...confirmed], leads: [...leads] };
}

/** Shared with the checklist so the two can't disagree about what a KBLI is. */
export function extractKbliCodes(text: string): string[] {
  return text.match(KBLI_CODE_RE) ?? [];
}
