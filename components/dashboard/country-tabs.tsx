"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SUPPORTED_JURISDICTIONS, type JurisdictionName } from "@/lib/countries";

export function CountryTabs({ value }: { value: JurisdictionName }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function choose(country: JurisdictionName) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("country", country);
    params.delete("conversationId");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="country-tabs" role="tablist" aria-label="Compliance jurisdiction">
      {SUPPORTED_JURISDICTIONS.map((country) => (
        <button
          key={country.code}
          type="button"
          role="tab"
          aria-selected={country.name === value}
          data-active={country.name === value}
          onClick={() => choose(country.name)}
        >
          <span className="country-code">{country.code}</span>
          {country.shortName}
        </button>
      ))}
    </div>
  );
}
