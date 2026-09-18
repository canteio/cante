import type { CustomerProfile, JurisdictionProfile } from "@/lib/db/schema";

// Completion is workspace-wide and survives both reloads and jurisdiction changes.
// Existing operating facts count too; old accounts have no new completion flag.
//
// This is currently a pure predicate with no caller — app/onboarding/page.tsx's
// own TODO ("wire new-customer redirects here once a durable onboarding-completed
// check exists") points at this function as that check. Kept and covered by
// onboarding-status.test.ts rather than deleted: the logic is correct and will
// unblock that redirect gate in a future run without needing to be re-derived.
export function hasOnboardingDetails(
  legacy: Partial<CustomerProfile> | null,
  profiles: Array<Partial<JurisdictionProfile> | null>,
): boolean {
  if (legacy?.productDescription?.trim() || legacy?.businessType?.trim()) return true;
  if ([legacy?.hsCodes, legacy?.kbliCodes, legacy?.destinationMarkets].some((rows) => rows?.length)) return true;
  return profiles.some((profile) => Boolean(profile && (
    profile.legalName?.trim() || [
      profile.facilityAddresses, profile.naicsCodes, profile.products, profile.skus,
      profile.materialsChemicals, profile.manufacturingProcesses, profile.wasteStreams,
      profile.distributionStates, profile.labelsClaims, profile.htsScheduleBCodes,
      profile.exportClassifications, profile.exportCountries, profile.regulatedProductFlags,
    ].some((rows) => rows?.length)
  )));
}
