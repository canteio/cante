# Earlier metal duties and historical PDF lookup

October 26, 2026. Local audit engine v9 work; the full historical-coverage goal
remains unfinished. No deployment, daily target or legal approval changed.

## Implemented

- Older PDF rate cells can retain an inline printed footnote, such as `4% 2/`.
  The rate and marker are separated; page-local definitions take precedence over
  conflicting marker numbers elsewhere in the chapter. Unknown definitions still
  withhold totals. General, Special and Column 2 text remain separate; retaining
  the latter two does not implement preference or Column 2 calculations.
- Initial 2018 China lists validate their original clauses and complete code
  tables, including the final list ending at the printed tariff-table header.
  They do not require later exclusion wording or absorb subsequent duty periods.
  The August 23 motor case now calculates USD 290 on fictional USD 1,000 input.
- March 2025–early April 2026 metal compilation uses complete dated Note 16/19
  tables, exact operative paragraph contracts and retained CBP instructions.
  It distinguishes primary goods, described existing derivatives and later
  chapter/other derivatives; exact statistical restrictions remain intact.
- June 4 changes use supported steel/aluminum content values where required,
  the separate UK rate, and reciprocal duty on the non-metal remainder. Combined
  country percentages retain the ordinary base on the whole article and apply
  only the exact additional percentage to the non-metal value. Compound-base
  allocations without established quantity allocation remain unresolved.
- Explicit product/material, content valuation, U.S. melt/pour or smelt/cast and
  Russian-content decisions are required where applicable. A positive Russian
  smelt/cast decision uses the supported 200% full-value aluminum treatment;
  a missing clearance does not become a positive Russian fact. Conflicting
  decisions withhold totals. Overlapping castings/derivative codes cannot charge
  both primary and derivative headings for the same aluminum.
- CBP 65054270 and 65236574 establish the change from border-first to metal-first
  priority for supported ordinary Canada/Mexico cases. Independent China duties
  remain. Zero metal content cannot establish a payable metal priority exemption.
- Public code tables and content-free cutoff proofs are compiled once and only
  exact-product membership is retained in each result; full guidance bodies are
  not copied into every entry. Described scopes have bounded product-definition
  excerpts available to the review UI. Prior results remain unchanged.
- Engine v9 leaves v1–v8 readable. New business facts remain tenant-scoped review
  decisions; they do not confer shared rule-review authority. The bounded enum
  of required facts replaces an obsolete eight-fact limit for combined programs.

Two operator-only original CBP guidance records were added, with no human-approval
claim or customer writes:
[65054270](https://content.govdelivery.com/accounts/USDHSCBP/bulletins/3e0a63e),
[65236574](https://content.govdelivery.com/accounts/USDHSCBP/bulletins/3e36e5e).
Content hashes and source versions remain pinned through the existing archive.

## Verification so far

- 129 focused tests, 931 existing regression tests, TypeScript and isolated
  website/worker builds passed. The final isolated website/worker builds and mocked worker fixtures also pass;
  no production build/deployment is claimed.
- Fifteen selected actual-source metal goldens pass, including dated China,
  Vietnam, UK, Canada/Mexico priority, EU/Japan combined allocation and aluminum
  with/without positive Russian content. Shipment evidence is fictional and the
  expected amounts are hand-entered; this is not independent legal validation.
- Six actual original PDF editions (2018, 2020–2024), each with China/Vietnam
  cases, pass. Unclaimed temporary reductions remain research leads rather than
  becoming inferred qualifications or automatic deductions.
- Real isolated Auth/database/worker acceptance passed a new 120-line fictional
  ledger: 81 initial calculations, 39 evidence decisions, 120 reviewed
  calculations, CSV, original-file hashes, immutable prior results, exact SKU
  associations and cross-company HTTP/RLS denials. Its fictional reviewed amounts
  are USD 73,203 potential overpayment and USD 4,497 potential underpayment,
  displayed separately. No customer's records served as disposable fixtures.
- Browser acceptance verifies the saved totals, three Russian-content
  underpayment rows and their independent base/301/232/IEEPA components, source
  links and relevant review controls. A dated aluminum-content correction from
  USD 800 to USD 600 creates revision 41, automatically recalculates expected duty
  from USD 919 to USD 839 and changes potential overpayment to USD 73,283 while
  keeping USD 4,497 underpayment separate. The exact corrected CSV row contains
  the original value, revised value, amount and evidence reference.
- The fixture browser signed out and closed; the harness finished and banned
  both identities. A redundant revocation after browser logout reported failure;
  the live aggregate database query confirms zero sessions for banned audit
  fixtures. Temporary 3132/3133 processes stopped; port 3000 stayed untouched.
- Screenshot: `/tmp/cante-earlier-metals-audit-results.png`, explicitly labeled
  synthetic. Private test credentials and execution artifacts remain outside the
  repository. Acceptance used isolated build `cante-history-build-mPDpi9`; final
  source/PDF/prefix/admission and scope-excerpt follow-ups pass focused tests and
  refreshed build `cante-history-build-BiDouI`. The newly added scope-excerpt
  display received build/type verification; it was not present in the browser
  acceptance build. No customer/UI deployment is claimed.
- The previous 120-line 2019–2026 original-source regression plus four combined
  cases still pass: 115 calculable lines, five deliberately invalid HTS lines;
  reviewed fictional totals remain USD 9,230 overpayment and USD 450 underpayment.

One read-only verifier attempt received PostgreSQL 57014 while reading an
original; it was not treated as missing law. Reference reads now allow one retry
for that specific cancelled-statement condition within the same 45-second
request deadline. Permission, missing-row, integrity and caller-cancellation
failures do not retry or gain numerical fallbacks. Targeted tests pass; a subsequent
actual-source verifier completed. This is bounded transient recovery, not a claim
that all database capacity or network failures are solved.

## Still unfinished

This closes selected earlier-metal and exact-PDF gaps, not the completion ledger.
The April–June 2026 transition, further 232 sectors, preferential/Column 2
calculations, broader AD/CVD and final assessments, temporary reductions and
special-entry/qualification cases still need work. U.S.-metal exemptions with
later overlapping programs, India/earlier-metal allocations and amendment days
whose retained edition predates the operative inclusion stay unresolved with an
explicit reason. Changed/unrecognized legal wording is not automatically accepted.

Use `test:historical-metals`, `verify:historical-metals-2025`, `verify:audit-pdfs`
and explicit `verify:audit-pilot-workflow -- --live <isolated-build>
--metals2025-only` for the respective verification scopes. Live acceptance writes
only isolated fictional Auth workspaces and retains their immutable histories;
it is not a setup command or permission to use customer records as fixtures.
