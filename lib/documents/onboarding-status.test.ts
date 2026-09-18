import assert from "node:assert/strict";
import { test } from "node:test";
import { hasOnboardingDetails } from "./onboarding-status";
import type { CustomerProfile, JurisdictionProfile } from "@/lib/db/schema";

// This function has existed untracked/uncommitted in the shared checkout for 5+
// engineering-cron runs with zero test coverage (flagged repeatedly in the
// company-plan timeline as "decide the fate of onboarding-status.ts"). It is
// real, correct logic that a future onboarding-completion redirect gate
// (app/onboarding/page.tsx's own TODO) will depend on, so it earns coverage
// now rather than being wired in blind or deleted as "abandoned".

test("hasOnboardingDetails: no legacy profile and no jurisdiction profiles is incomplete", () => {
  assert.equal(hasOnboardingDetails(null, [null]), false);
});

test("hasOnboardingDetails: legacy productDescription alone counts as complete", () => {
  const legacy = { productDescription: "Injection-molded plastic housings" } as Partial<CustomerProfile>;
  assert.equal(hasOnboardingDetails(legacy, [null]), true);
});

test("hasOnboardingDetails: legacy businessType alone counts as complete", () => {
  const legacy = { businessType: "Manufacturer" } as Partial<CustomerProfile>;
  assert.equal(hasOnboardingDetails(legacy, []), true);
});

test("hasOnboardingDetails: whitespace-only legacy text fields do not count", () => {
  const legacy = { productDescription: "   ", businessType: "\t" } as Partial<CustomerProfile>;
  assert.equal(hasOnboardingDetails(legacy, [null]), false);
});

test("hasOnboardingDetails: a non-empty legacy hsCodes array counts as complete", () => {
  const legacy: Partial<CustomerProfile> = {
    hsCodes: [{ code: "3926.90", basis: "manual", confirmed: false }],
  };
  assert.equal(hasOnboardingDetails(legacy, [null]), true);
});

test("hasOnboardingDetails: an empty legacy destinationMarkets array does not count", () => {
  const legacy = { destinationMarkets: [] } as Partial<CustomerProfile>;
  assert.equal(hasOnboardingDetails(legacy, [null]), false);
});

test("hasOnboardingDetails: a jurisdiction profile legalName alone counts as complete", () => {
  const profile = { legalName: "Acme Trading Co" } as Partial<JurisdictionProfile>;
  assert.equal(hasOnboardingDetails(null, [profile]), true);
});

test("hasOnboardingDetails: a jurisdiction profile with only empty arrays does not count", () => {
  const profile = {
    facilityAddresses: [],
    naicsCodes: [],
    products: [],
  } as Partial<JurisdictionProfile>;
  assert.equal(hasOnboardingDetails(null, [profile]), false);
});

test("hasOnboardingDetails: any one populated jurisdiction array field counts as complete", () => {
  const profile: Partial<JurisdictionProfile> = {
    naicsCodes: [{ code: "326199", basis: "manual", confirmed: false }],
  };
  assert.equal(hasOnboardingDetails(null, [profile]), true);
});

test("hasOnboardingDetails: multiple jurisdiction profiles, only one populated, still counts", () => {
  const empty = { legalName: "" } as Partial<JurisdictionProfile>;
  const populated = { skus: ["SKU-100"] } as Partial<JurisdictionProfile>;
  assert.equal(hasOnboardingDetails(null, [empty, populated]), true);
});
