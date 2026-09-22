# Market, positioning, and TAM

> Researched 20 Aug 2026. Every figure below is labelled **[verified]** (read
> from a named primary or reputable secondary source, cited inline) or
> **[assumed]** (my estimate or reasoning). That distinction is the same
> discipline `CLAUDE.md` applies to source coverage, and it matters more here,
> not less: a market doc is almost entirely estimates, and one unlabelled
> guess quoted back in a fundraising or pricing conversation is exactly the
> failure rule 2 exists to prevent.
>
> This file answers three questions: what are we actually selling, how are we
> different from the companies that already have money and customers, and how
> big is the thing we are pointed at.

---

## 1. What changed in 2026 — the demand environment is not a guess anymore

Cante was built on an intuition that trade rules change faster than a small
manufacturer can track. The 2026 record makes that measurable rather than
rhetorical. **[verified]**

| Date | Event |
|---|---|
| 20 Feb 2026 | Supreme Court holds IEEPA tariffs unlawful, 6–3 (Roberts) |
| 24 Feb 2026 | Section 122 temporary import surcharge replaces them — 10%, raised to 15%, on a 150-day statutory clock |
| 7 May 2026 | Court of International Trade rejects Section 122; Federal Circuit stays the injunction, so collection continues |
| 3 Jun 2026 | EO *"Strengthening Customs Enforcement"* — bond or minimum tangible-asset requirements for **all** importers of record, formal and informal entries; 90–180 day implementation |
| 24 Jul 2026 | Section 122 expires by operation of law; **new Section 301 forced-labour duties of 10–12.5% on 60 economies take effect the same minute** |
| ongoing | IEEPA refund claims through ACE/CAPE |

Four changes to landed cost in five months, plus a bonding and enforcement
overhaul still in rulemaking.

**Two consequences that change the strategy, not just the pitch:**

1. **The June EO supplies the thing this product structurally lacked.** The
   Vanta analogy in `competitive-roadmap.md` always broke at one joint: Vanta
   sells a SOC 2 report that a *customer's customer* demands before signing, so
   there is an external party creating urgency and a dated artifact that
   unblocks revenue. Cante had no equivalent — nobody demands a "Cante report".
   The EO makes **CBP** that party, and it is aimed explicitly at small and
   foreign importers with lean compliance practices. That is our segment, named
   in an executive order. **[verified]** — that this converts to willingness to
   pay is **[assumed]**.
2. **Volatility is structural, not a window.** I previously wrote that tariff
   chaos "cannot be counted on to last". Wrong. Each authority struck down has
   been replaced within hours under a different one, and each replacement
   carries its own expiry and its own litigation. Planning for a return to a
   stable schedule is planning for the wrong world.

Non-software corroboration, which is stronger than any funding round:
**DHL added 680+ customs, finance and service specialists this year, and DHL
Global Forwarding is expanding US clearance capacity 40% — 200+ new customs
agents on top of 500 existing brokers.** **[verified]** A logistics major is
solving this with payroll because the work is real and growing.

---

## 2. Who is already being paid, and for what

The important finding is not that competitors exist. It is **what shape of
product has money attached**. **[verified]** except where noted.

| Company | Sells | Evidence |
|---|---|---|
| **Trava** (YC W25) | Audits US customs entries for misclassification and overpaid duty; classification automation. Deterministic rule engine for all calculations, AI only for interpreting source documents, **licensed brokers and trade specialists validating edge cases** | **~$40k ACV large importers, ~$10k SMB — sold *through customs brokers*.** First audit in 72 hours, monitoring after onboarding |
| **Outpost** | Cross-border trade compliance and payments infrastructure | **$17.5M Series A led by Ribbit, Mar 2026** |
| **Gaia Dynamics** | Tariff Audit engine quantifying overpayment / underpayment / IEEPA refund exposure | Launched Mar 2026, timed to the SCOTUS ruling |
| **Onyx** | HS-code and geography regulatory monitoring — the closest analogue to Cante's core | Bundles **analyst access** for interpreting alerts. Pricing not published |
| **Quickcode, Tarifflo, Cervo, Digicust, Camtom, Freehand, GingerControl** | Classification and broker automation | Crowded field of AI-native 2025–26 entrants |
| **NAVEX, MetricStream, Riskonnect, Regology** | Enterprise regulatory-change management | Sold to organisations that already employ a compliance team |

### The pattern, stated plainly

Every funded or revenue-generating company in that table sells one of four
things:

1. **An audit that produces a recoverable dollar number** — Trava, Gaia
2. **Classification automation** — Quickcode, Tarifflo, Cervo, Digicust
3. **Monitoring plus a human analyst** — Onyx
4. **Enterprise GRC monitoring to companies with compliance staff** — NAVEX,
   MetricStream, Regology

Cante today occupies a fifth cell: **pure automated monitoring, sold to SMBs
with no compliance team, with no human attached.** That cell is empty.

We have been reading the empty cell as the wedge. The evidence says it is
mostly the explanation. Onyx staples an analyst on; Trava staples licensed
brokers on. Two independent companies serving this need concluded that an
unaccompanied alert does not close, and neither is a naive builder. **[assumed,
but it is the reading the evidence most supports]**

Two details of Trava's architecture should be read carefully, because they are
Cante's design with the missing half added: a deterministic rule engine owning
every calculation, AI confined to interpreting source documents, and humans on
edge cases. That is `lib/tariff/` + `lib/checks/judge.ts` + a person we do not
have. And **"~$10k SMB via brokers"** answers the CAC/ACV problem directly —
the channel is the broker, not cold outbound.

---

## 3. How we are actually different

Split honestly. Claiming the weak column is how a deck stops being believable.

### Real, defensible

1. **Indonesia depth that nobody in the researched set has at all.** 13 live
   official Indonesian sources, verified by real fetch, not documentation:
   Kemendag (3 views), Setneg, Kemenkeu, DJBC, DJP, KLH, Kemnaker, OSS, BSN,
   Surabaya JDIH + DLH, East Java (4 views via the undocumented
   `api.jdih.jatimprov.go.id` subdomain that bypasses the Cloudflare wall), and
   Kemenperin through pasal.id. Plus a mapped graveyard: which hosts are
   bot-blocked, which are geo-restricted, which have been dark for two years.
   That map cost real probing and is not reconstructible from a blog post.
2. **The bilateral corridor — the strongest position we hold.** Trava, Gaia and
   Onyx are US-only. E2open and Descartes are global but enterprise-priced with
   enterprise onboarding. Nobody runs Indonesian regulatory monitoring *and* US
   trade controls in one system keyed to the same company. We already have both
   sides built (`lib/sources/registry.ts` for ID, `lib/screening/` +
   `lib/tariff/` for US).
3. **Disclosed non-coverage as a machine-checkable product property.** Every
   competitor's answer to "how do I know you didn't miss something?" is a human:
   Onyx's analyst, Trava's brokers. Ours is `source_results`,
   `auditVerdictCoverage()`, and code-written caveats the model cannot suppress.
   **It is the only version of that answer that scales without headcount**,
   which is the entire economic argument for a one-person company competing
   here. It is also the hardest thing on this list to explain in a 20-minute
   call — see §6.
4. **Tier discipline reaching the SKU.** `document` / `human` / `lead` / `guess`
   is structurally enforced, not documented-and-hoped:
   `approveClassification()` refuses `lead` and `guess`, `POST
   /api/classifications` refuses `tier: "document"` outright, and only
   `promoteCodesFromDocument()` — which requires a readable document number and
   date — can mint the verified tier. That is a reasonable-care and audit-defence
   story, and the June EO just made reasonable care more expensive to fake.
5. **Regulatory delta rendering.** `lib/checks/briefing.ts` produces
   before → after rows rather than "PP 20/2026 — worth a look". Verified live
   against the real PP 20/2026, and it independently matched a Gemini answer on
   the same regulation while additionally finding the transition provision and
   the new non-deductibility of bribes.

### Not differences — stop claiming them

- **"AI reads regulations."** Everyone in §2 says this.
- **Classification.** Four companies do it, some with licensed-broker validation
  we do not have. `lib/classification/suggest.ts` is good but it is table stakes,
  not a wedge.
- **Duty audit.** Trava and Gaia are ahead, funded, and have humans in the loop.
  We can enter this, but as a fast follower, not an innovator.
- **Monitoring per se.** Free from every trade law firm's client alerts, free
  from CBP's own CSMS list, and the paid tier is owned by enterprise GRC.

---

## 4. TAM

Three layers, with the arithmetic shown so any assumption can be replaced.

### United States

**Verified inputs:**

- **239,231 identified US importers** in 2024, accounting for $2,921B of the
  $3,266B in goods imports (Census, *Profile of US Importing and Exporting
  Companies*). **[verified]**
- **~350,000 active importers of record** in a given year (CBP Broker
  Management Branch) — a broader definition that includes infrequent filers.
  **[verified]**
- **SMEs (<250 employees) are 96–97% of US importers but only 32% of import
  value.** In manufacturing and wholesale specifically, small firms are 94–99%
  of importers, against $602B and $451B of value. **[verified]**
- **~2,093 permitted customs brokers**; ~14,454 licensed individuals.
  **[verified]**

**TAM (theoretical ceiling).** 239,231 importers × $6,000/yr ($500/mo) ≈
**$1.4B**. Presented only to be dismissed — it assumes universal adoption of a
product most of these firms import too rarely to need. **[assumed]**

**SAM (importers with enough duty at stake to act).** ~231,000 SME importers,
but the value is heavily skewed. Take the subset with import value above ~$1M
and a non-trivial duty bill — **[assumed]** at 15–20% of SME importers, i.e.
**~35,000–46,000 firms**:

| At | SAM |
|---|---|
| $6k/yr (Cante's current $500/mo) | **$210–280M** |
| $10k/yr (Trava's observed SMB ACV) | **$350–460M** |

**SOM (what a one-person company can realistically reach).** At 0.1% of the
low SAM over three years: ~35–46 customers, **$210k–460k ARR**. **[assumed]**
That is the honest ceiling for the current shape of the company, and it is a
good living rather than a venture outcome.

**The channel number is the one that matters.** 350,000 importers ÷ 2,093
permitted brokers ≈ **167 importers per broker** **[verified inputs, assumed
evenness]**. Ten broker relationships is nominal access to ~1,600 importers.
That is the only arithmetic on this page where a single person's effort
compounds, and it is exactly the motion Trava's "~$10k SMB via brokers" implies
they already found.

### Indonesia

- **~25,000 large and medium manufacturing enterprises**, ~6M workers, $216.6B
  manufacturing value added projected for 2025. **[verified — secondary source
  (Statista), not BPS directly; confirm against BPS *Statistics of Indonesia
  Manufacturing Industry* before quoting externally]**
- Count of API-U / API-P holders: **not found in public sources.** Do not
  invent one. **[gap]**

TAM at IDR 3jt/mo (~$200/mo, a realistic Indonesian SMB price rather than the
$500 in `HANDOFF.md`): 25,000 × $2,400 ≈ **$60M**. **[assumed]** An order of
magnitude below the US, which is the central strategic tension: **our deepest
pack points at our thinnest wallet.**

### The corridor — the number worth acting on

- **Indonesia exported $31.02B of goods to the US in 2025** (11.6% of Indonesian
  exports; the US is Indonesia's largest surplus contributor). **[verified]**
- **On 24 July 2026 Indonesia was placed in the 10% band** of the new Section
  301 forced-labour action — alongside India, Malaysia, Bangladesh, Mexico;
  China, Vietnam, Brazil took 12.5%. **[verified]**

At face value that is **~$3.1B/yr of new US duty exposure** landing on
Indonesian exporters, created four weeks ago, written in a US legal instrument
they cannot read, and administered by an agency they have never dealt with.
**[assumed — a rough gross figure; actual incidence depends on product mix,
exclusions, and who bears the duty contractually]**

**We are the only company identified in this research with a working Indonesian
regulatory pack and a working US Section 301 / UFLPA / forced-labour pack in
the same system.** Not the largest market. The one where the competitor count
is zero.

---

## 5. What we are doing — positioning

**Old (implicit):** "A daily monitor that reads Indonesian government sites and
tells a factory owner what changed."

The problem is not that this is untrue. It is that it describes cell five —
unaccompanied monitoring for SMBs — which the market has not paid for.

**New, two lanes, both drawing on the same engine:**

> **Lane A — Corridor.** For Indonesian manufacturers selling into the US:
> the one system that watches your Indonesian obligations (KBLI, OSS, SNI,
> Perda, tax, labour, environment) *and* what the US just did to your goods on
> arrival. Nobody else covers both ends.
>
> **Lane B — Audit-led US.** For US SMB importers, reached **through their
> customs broker**: a fixed-fee entry audit that returns a dollar number
> (overpaid, underpaid, misclassified), with the monitor sold as how that
> number stays true next quarter.

The positioning line from `HANDOFF.md` survives and gets sharper:

> "If you have a compliance manager, buy Assent. I'm for companies where it's
> nobody's job — and I'll tell you what I couldn't check."

**The honest limit that must be stated in every sales conversation, unchanged:**
Cante catches rules that *change*. It does not audit whether you are already
non-compliant with a rule published years ago. Saying this first wins more
meetings than any feature.

**A second limit to add, from this research:** we have no licensed customs
broker and no trade attorney. Trava validates edge cases with both. Until we
have at least an on-call relationship, we cannot credibly sell a *defensible*
audit — only an indicative one — and the difference must be stated, not
blurred. **[assumed but high confidence]**

---

## 6. Risks this research surfaced

1. **Trava is the direct competitor and is ahead.** YC-backed, broker channel,
   licensed-broker validation, $10–40k ACVs, 72-hour first audit. Racing them
   head-on in the US audit market from one Mac with zero customers is a bad bet.
   Lane B should be entered through brokers *they have not signed*, or not at all.
2. **Our best differentiator does not survive a short call.** The coverage-audit
   discipline is genuinely the most defensible thing in the codebase and an SMB
   ops manager will not grasp it. It converts a technical strength into a
   trust-building asset only after someone is already in a pilot. Plan the sale
   around the dollar number; keep the honesty as retention, not acquisition.
3. **Honesty costs deals and we should accept that.** We monitor 4 US state
   registers; a distributor selling into 30 states will hear that, because our
   own rules force us to say it. That is correct. Budget for the lost deals.
4. **Nothing in the US pack has ever touched a real company.** `US-plan.md`
   states it: the first evidence-grounded US judgment run still needs a real
   pilot profile. The Indonesian pack has source coverage tests. The US pack was
   built from API documentation.
5. **The audit market has a one-time-revenue trap.** IEEPA refunds and entry
   audits are recovery events, not subscriptions. They are the land. If the
   expand does not attach, this is a services business — which is a legitimate
   outcome, but should be chosen rather than discovered.
6. **The moat stays thin.** ~28,000 lines in five days. The Indonesian source
   map and the accumulated per-customer ledger are the durable parts; the
   monitoring engine is not.

---

## 7. Falsifiable tests, in order

The point of writing numbers down is to be able to be wrong about them.

1. **One Indonesian exporter to the US, asked whether the 24 July 10% band
   changed their landed cost.** If they already knew, the corridor thesis is
   weaker than it looks. If they did not, that is the demo.
2. **One customs broker asked whether they would resell an entry audit.** Ten
   minutes, tests the entire Lane B channel assumption, and 2,093 is a
   knowable list.
3. **A customer pays without being asked twice** — money, at a stated price, not "this
   is useful".
4. **One alert prevents one concrete cost.** The 8 mandatory-SNI Permenperin
   rules already surfaced through pasal.id are the best live candidate.

---

## Sources

Verified figures above come from: Census Bureau *Profile of US Importing and
Exporting Companies* (239,231 importers; SME shares); CBP Broker Management
Branch via Federal Register (350,000 IORs; 2,093 permitted brokers); USTR
Section 301 forced-labour final action, 23 Jul 2026 (60 economies; Indonesia at
10%); WilmerHale, Holland & Knight, Perkins Coie and Ropes & Gray client alerts
on the 20 Feb 2026 SCOTUS IEEPA decision; WilmerHale and BDO on the 3 Jun 2026
EO "Strengthening Customs Enforcement"; Nakachi Eckhardt & Jacobson and Global
Trade Alert on the Section 122 surcharge and its 24 Jul expiry; FreightWaves on
DHL customs hiring; PRNewswire on Gaia Dynamics' Tariff Audit engine;
fintech.global on Outpost's Series A; usetrava.com and FYI Combinator on Trava;
onyxsi.com on Onyx; Fortune Business Insights and Grand View Research on trade
management software market size; Trading Economics and BPS on Indonesia–US
trade values.
