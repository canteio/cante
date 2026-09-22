import { normalizeJurisdiction } from "@/lib/countries";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

// TODO: Wire new-customer redirects here once a durable onboarding-completed check exists.
export default async function Page({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  const params = await searchParams;
  // Preserve an explicit jurisdiction; otherwise use DEFAULT_JURISDICTION (US),
  // the default for new customers.
  return <OnboardingWizard country={normalizeJurisdiction(params.country)} />;
}
