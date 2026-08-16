# Indonesia source coverage

Verified 16 August 2026. This document distinguishes automated coverage from
known gaps. "Full coverage" means every configured source is fetched and every
new or changed document is evaluated; it does not mean every Indonesian agency
currently exposes a usable central feed.

## Automated daily

| Area | Official source | Automation |
|---|---|---|
| Trade | JDIH Kemendag | Three listing views: all, export, and licensing. Detail pages provide legal dates. |
| UU, Perpu, PP, Perpres, Keppres, Inpres | JDIH Setneg | Unauthenticated JSON API, all pages for the current and prior year. |
| Finance ministry rules | JDIH Kemenkeu | Current listing monitored. |
| Customs | DJBC regulation portal | Newly added regulations parsed from the official portal. |
| Tax | DJP regulation portal | Current regulation listing parsed from the official portal. |
| Environment | JDIH KLH/BPLH | Unauthenticated JSON API with legal dates and official PDFs. |
| Labor and OHS | JDIH Kemnaker | Latest regulations parsed from the official listing. |
| Standards catalogue | BSN SNI catalogue | Catalogue changes monitored; mandatory applicability still needs legal interpretation. |
| Licensing availability | OSS | Service/catalogue heartbeat only, not private company licensing status. |
| Surabaya rules | JDIH Surabaya | Unauthenticated JSON endpoint, all pages for the current and prior year. |
| Surabaya environment | DLH Surabaya | AMDAL, UKL-UPL, DELH, and DPLH notices in a rolling 45-day window. |

Every successful fetch writes a `source_results` record. Full inventories are
fingerprinted in `source_documents`. The first inventory sends at most ten
documents per source to judgment and records the rest as historical baseline;
later checks judge only new or changed documents. A changed document at the
same official URL is still re-evaluated.

## Known gaps

| Gap | Current status |
|---|---|
| Nationwide Permen and Kepmen across every ministry | No reliable central document feed. Ministry JDIHs must be added individually based on the customer's KBLI, products, permits, and markets. |
| East Java provincial rules | The public JDIH works in a browser but blocks unattended requests with Cloudflare. It remains a disclosed manual check. |
| BPK regulation database | Bot detection blocks unattended collection. Manual lookup only. |
| JDIHN central portal | Old endpoint times out and the replacement is not a dependable central document API. |
| OSS company licensing status | Requires authorized company access; the public endpoint only proves service availability. |
| Mandatory SNI applicability | Catalogue monitoring is automated, but determining which SNI is mandatory requires the governing regulation and product facts. |
| INSW restrictions and lartas | No stable public machine-readable integration has been verified. |
| Permit and certificate validity | Requires customer documents or authorized account integrations. |

These gaps must remain visible in alerts and the checklist. A blocked source is
never reported as "checked, no changes."

## Expansion leads

- BPHN publishes the ILDIS/JDIHN integration convention, commonly exposed by
  members as `/feed/document.json`. Adoption and data quality vary by agency.
- Kemenperin ILMATE, BPOM, BPJPH/halal, and SIKIPO are candidates for dedicated
  adapters once a customer's products and regulated activities make them
  relevant.
- Other city and regency JDIHs should be activated from the customer's operating
  locations, not fetched globally for every tenant.

## Live verification

- New adapters fetched 459 official records without a source failure: Setneg
  263, KLH 30, Kemnaker 15, DJBC 10, DJP 5, Surabaya JDIH 123, and Surabaya DLH
  13.
- Full check `282f54b9-6a60-4bda-849f-f14c93440707` fetched 513 records across
  13 active sources. It judged 76 bootstrap documents and stored 403 older
  documents as baseline.
- Immediate repeat check `6c05be50-b142-47f3-80b5-ba9300895d3d` fetched the same
  513 records, found zero new or changed documents, made zero judgment calls,
  and produced zero findings.
