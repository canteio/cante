import assert from "node:assert/strict";
import test from "node:test";
import {
  extractKbliCodes,
  renderHsCodesForPrompt,
  resolveHsCodes,
  resolveKbliCodes,
} from "./facts";
import type { CustomerProfile, Memory } from "@/lib/db/schema";

/**
 * facts.ts is the single arbiter of "what HS/KBLI code is actually known"
 * for a customer, and it had zero test coverage despite the file's own
 * comments warning this is the exact logic that once let a judgment prompt
 * assert two contradictory HS codes in the same breath. These tests lock in
 * the tier precedence (document > human > lead > guess) and the superseding
 * behaviour so a future edit can't silently regress it.
 */

function makeProfile(overrides: Partial<CustomerProfile> = {}): CustomerProfile {
  return {
    id: "profile-1",
    customerId: "cust-1",
    productDescription: "rattan furniture",
    businessType: null,
    sideOfTrade: "export",
    hsCodes: [],
    kbliCodes: [],
    destinationMarkets: [],
    hsCodesConfirmed: false,
    destinationsConfirmed: false,
    ...overrides,
  } as CustomerProfile;
}

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "mem-1",
    customerId: "cust-1",
    jurisdiction: "Indonesia",
    kind: "other",
    content: "",
    source: null,
    origin: "manual",
    confirmed: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Memory;
}

test("resolveHsCodes: a document-verified profile code is never demoted to a guess", () => {
  const profile = makeProfile({
    hsCodesConfirmed: true,
    hsCodes: [{ code: "4421.99", basis: "PEB export document", confirmed: false }],
  });
  const resolved = resolveHsCodes(profile, []);

  assert.equal(resolved.documentVerified, true);
  assert.equal(resolved.document.length, 1);
  assert.equal(resolved.document[0].tier, "document");
  assert.equal(resolved.guesses.length, 0);
});

test("resolveHsCodes: an unconfirmed profile code is a guess until confirmed", () => {
  const profile = makeProfile({
    hsCodesConfirmed: false,
    hsCodes: [{ code: "4421.99", basis: "seeded from product description", confirmed: false }],
  });
  const resolved = resolveHsCodes(profile, []);

  assert.equal(resolved.documentVerified, false);
  assert.equal(resolved.document.length, 0);
  assert.equal(resolved.guesses.length, 1);
  assert.equal(resolved.guesses[0].tier, "guess");
  assert.equal(resolved.guessesSuperseded, false);
});

test("resolveHsCodes: a confirmed memory promotes a code to human tier and supersedes the guess", () => {
  const profile = makeProfile({
    hsCodesConfirmed: false,
    hsCodes: [{ code: "4421.99", basis: "seeded guess", confirmed: false }],
  });
  const memories = [
    makeMemory({ kind: "hs_code", content: "Confirmed HS code 4421.99 with the buyer.", confirmed: true }),
  ];
  const resolved = resolveHsCodes(profile, memories);

  assert.equal(resolved.human.length, 1);
  assert.equal(resolved.human[0].code, "4421.99");
  // the same code must not also appear as an active guess once a human tier exists
  assert.equal(resolved.guesses.some((g) => g.code === "4421.99"), false);
  assert.equal(resolved.guessesSuperseded, true);
});

test("resolveHsCodes: an unconfirmed memory is a lead, and leads never include a code already human-confirmed", () => {
  const profile = makeProfile();
  const memories = [
    makeMemory({ kind: "hs_code", content: "HS code 6306.19.90 mentioned in chat.", confirmed: false }),
    makeMemory({ kind: "hs_code", content: "HS code 3921.90 confirmed.", confirmed: true }),
    makeMemory({ kind: "hs_code", content: "Also possibly 3921.90?", confirmed: false }),
  ];
  const resolved = resolveHsCodes(profile, memories);

  assert.deepEqual(
    resolved.leads.map((l) => l.code),
    ["6306.19.90"],
  );
  assert.deepEqual(
    resolved.human.map((h) => h.code),
    ["3921.90"],
  );
});

test("renderHsCodesForPrompt: discloses when nothing is document-verified", () => {
  const resolved = resolveHsCodes(makeProfile(), []);
  const text = renderHsCodesForPrompt(resolved);
  assert.match(text, /Document-verified: NONE/);
});

test("renderHsCodesForPrompt: marks a leftover guess as superseded once ANY human code is confirmed", () => {
  // The guess (2222.22) is for a different code than the one a human confirmed
  // (1111.11), so it survives filtering and must render as superseded rather
  // than as a still-live guess.
  const profile = makeProfile({
    hsCodes: [{ code: "2222.22", basis: "old guess, never revisited", confirmed: false }],
  });
  const memories = [makeMemory({ kind: "hs_code", content: "HS code 1111.11 confirmed.", confirmed: true })];
  const resolved = resolveHsCodes(profile, memories);
  const text = renderHsCodesForPrompt(resolved);

  assert.equal(resolved.guesses.length, 1);
  assert.match(text, /SUPERSEDED seed-time guesses/);
  assert.match(text, /judge against them/);
});

test("resolveKbliCodes: confirmed codes win over unconfirmed leads for the same code", () => {
  const profile = makeProfile({ kbliCodes: ["16292"] });
  const memories = [
    makeMemory({ kind: "kbli", content: "KBLI 16292 pending review", confirmed: false }),
    makeMemory({ kind: "kbli", content: "NIB shows KBLI 46900", confirmed: true }),
  ];
  const resolved = resolveKbliCodes(profile, memories);

  assert.deepEqual(resolved.confirmed.sort(), ["16292", "46900"]);
  assert.equal(resolved.leads.includes("16292"), false);
});

test("extractKbliCodes: pulls every 5-digit code out of free text", () => {
  assert.deepEqual(extractKbliCodes("OSS lists KBLI 46900 and 16292 for this entity."), [
    "46900",
    "16292",
  ]);
  assert.deepEqual(extractKbliCodes("no codes here"), []);
});
