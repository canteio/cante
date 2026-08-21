# US Lead List

Real companies, pulled from an official federal database, with dated compliance pain.

---

## The number that is your pitch

I pulled every US consumer product recall in 2026 from the CPSC database:

| | Count |
|---|---|
| Recalls since 1 Jan 2026 | **391** |
| Caused by **violating a published mandatory standard** | **203 (51%)** |
| Caused by an actual product defect | 188 |

**Half of these recalls were not accidents.** They were companies importing goods that failed a rule which already existed, in public, before the container shipped. Nobody was watching the rule.

That is not a pitch you have to construct. It is the finding.

---

## What this list is, and isn't

**Is:** 28 real US importers and distributors, named in official CPSC recall notices between 9 July and 13 August 2026. Every name, city and hazard below came out of the government's own API. Their pain is dated and provable.

**Isn't:** contact details. I have not invented a single name, email or phone number, and you should be suspicious of any list that hands you those. Finding the right person is your job, and it takes about four minutes each — see below.

**Caveats worth holding:**

- A recall is a **past** event. Some of these already hired a consultant in the aftermath. That's fine — they've just been reminded the problem is real, which is the best moment to hear from you.
- Recency matters more than anything. The 13 August names are worth more than the 9 July ones.
- Some are bigger than they look. Check headcount on LinkedIn before you write; under ~200 people is your zone.

---

## The method (worth more than the list)

The list goes stale in a month. This doesn't:

```bash
curl -s "https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2026-08-01" \
  | python3 -m json.tool | less
```

Free, no key, updated continuously. Filter to `Importers` and `Distributors` — the `Manufacturers` field is mostly foreign factories and `Retailers` is mostly Amazon.

Run it monthly. Every new recall is a company that just had a bad week and can name the exact date it happened.

**Your product already fetches this feed** (`us-cpsc-recalls`). You built the prospecting tool without noticing.

---

## The list

Sorted newest first. All 2026.

| Date | Company | Location | What went wrong |
|---|---|---|---|
| 13 Aug | **Lisse USA LLC** | Brooklyn, NY | Minifridge switch short-circuits — fire hazard |
| 13 Aug | **Fastbuy Inc.** (Zimtown) | Metuchen, NJ | Fuel containers **violate** child-resistant closure standard |
| 13 Aug | **GigaCloud Technology (USA)** | El Monte, CA | Murphy bed frame collapse during assembly |
| 13 Aug | **Ritchey Design** | Reno, NV | Carbon bicycle fork crown insert failure |
| 13 Aug | **Southern Telecom Inc.** | Brooklyn, NY | Tabletop fire pits — uncontrolled fuel pooling |
| 13 Aug | **SUGIFT, Inc.** | Albany, NY | Pressure washers lack integral grounding |
| 13 Aug | **Sunnyside Corporation** | Wheeling, IL | Pre-filled fuel containers **violate** mandatory standard |
| 13 Aug | **Taleco Gear** | La Verne, CA | Baby jumpers and swings |
| 13 Aug | **Yamazuki Inc.** | Ontario, CA | Youth ATVs **violate** mandatory safety standard |
| 6 Aug | **EEMB USA** (A2batt) | Redlands, CA | Battery chargers **violate** mandatory standard |
| 6 Aug | **DR Power Equipment** | S. Burlington, VT | Mowers **violate** mandatory safety standard |
| 6 Aug | **Fitueyes, Inc.** | City of Industry, CA | Dresser tip-over instability |
| 6 Aug | **HEAD USA** (Head Watersports) | — | Dive regulators restrict airflow |
| 6 Aug | **KC Imports and Exports** | Vernon, CA | Laser pointer keychains **violate** mandatory standard |
| 6 Aug | **Louisville Ladder, Inc.** | Louisville, KY | Attic stairway ladder bolts break |
| 6 Aug | **OKK Trading, Inc.** | Vernon, CA | Headbands **violate** mandatory safety standard |
| 6 Aug | **Wichard Groupe N. America** | N. Kingstown, RI | Spliced rope terminations fail |
| 30 Jul | **BenQ America Corp.** | Costa Mesa, CA | Projector lithium battery overheats |
| 30 Jul | **Golden Link** | Middletown, NY | Cups/containers **violate** mandatory standard |
| 30 Jul | **HARPPA, Inc.** | Denver, CO | Tower stools collapse |
| 30 Jul | **Jake's Fireworks, Inc.** | Pittsburg, KS | Rockets explode prematurely |
| 30 Jul | **Joyin US Corp.** | Chandler, AZ | Dive sticks **violate** federal standard |
| 16 Jul | **Huish Outdoors, LLC** | Salt Lake City, UT | Regulator inlet tube cracks |
| 16 Jul | **J. Crew Group** | New York, NY | Sweaters **violate** flammability standard |
| 16 Jul | **Madewell Inc.** | New York, NY | Sweaters **violate** flammability standard |
| 16 Jul | **TOMY International** | Oak Brook, IL | Toddler towers tip over |
| 16 Jul | **Warren James, Inc.** | Santa Monica, CA | Lunch box cup — **high lead concentration** |
| 9 Jul | **Jomani International** | Monterey Park, CA | Gun safe biometric lock opens for unauthorised users |

**Start with the bolded "violate" rows.** Those are the ones where a published rule existed and nobody was watching it. That is literally the product.

**Best five to open with**, on size and fit: SUGIFT, Taleco Gear, HARPPA, Golden Link, KC Imports. Small, importer-shaped, recent, standard-violation.

---

## Finding the person (about 4 minutes each)

1. Company site → **About / Contact**. Small importers often list a general inbox.
2. LinkedIn → search the company, filter to roles containing *compliance*, *quality*, *operations*, *supply chain*. In a 30-person importer, that's often the **owner** or **VP Operations**.
3. If neither: the CPSC recall notice itself lists a consumer contact number. Call it and ask who handles compliance.

Do not buy a list. At this volume, hand-finding is faster and the quality is incomparable.

---

## What to send

Short, specific, no pitch deck. Reference *their* recall.

> **Subject: your [product] recall — the standard was published before you imported**
>
> Hi [name],
>
> I saw the CPSC notice on [date] about the [product]. The reason it caught my eye: it was a *mandatory standard* violation, not a defect. That rule existed before the shipment landed.
>
> I run a small service that watches CPSC, EPA, OSHA and customs rule changes daily and tells one company — in plain language — when something touches their specific products. I pulled the 2026 recall data: **51% were standard violations, not defects.** Every one of those was, in principle, catchable.
>
> Happy to run a free check on your current catalogue and send you what I find. No obligation and no deck — just the output.
>
> [you]

**Why this works:** you're not selling monitoring. You're pointing at a thing that already happened to them and offering to check whether it's about to happen again. Same free-audit wedge as the Indonesian plan, different document.

---

## Other public pain databases

Same principle — a company in an enforcement database has dated, provable pain and a public name:

| Source | Who it surfaces | Access |
|---|---|---|
| **CPSC recalls** | Importers with product-standard failures | Free API, already integrated |
| **FDA warning letters** | Food, device, cosmetic manufacturers | openFDA API, free |
| **OSHA enforcement** | Facilities with safety citations | DOL data, free |
| **EPA ECHO** | Facilities with environmental violations | Free API |
| **CBP CROSS rulings** | Companies that *asked* about a classification — self-identified uncertainty | Free API, already integrated |
| **Section 301 exclusion requests** | Importers actively bleeding on tariffs | USTR portal |

CROSS is the sleeper. A company that filed a ruling request has *told the government in writing* that it wasn't sure how to classify something. You already fetch that feed.

---

## The same method, in Surabaya

Everything above works closer to home, and probably better:

- **Kemnaker** publishes labour and OHS enforcement
- **KLH/BPLH** publishes environmental sanctions and AMDAL notices
- **DJBC** publishes customs enforcement
- **Surabaya DLH** publishes local environmental notices — you already fetch this one

A Surabaya factory that just received an environmental sanction has the same acute, dated pain as a US importer with a recall — plus you can visit them, you speak the language, and there's no competitor in the room.

---

## The honest note

You asked for US customers, so this is the best US list I can build without inventing anything. It's real and it's usable.

It is still the harder path. These companies have alternatives — brokers, consultants, Assent, Quickcode — and you have no US presence, no references, and no way to visit. Every one of these conversations starts colder than a conversation in your own city.

If you want the fastest route to one paying customer, it's still five Surabaya factories and the NIB audit. If you want the *bigger* market and you're willing to take longer, this list is a real place to start.

Both are defensible. Just don't run both at once — you have time for one.
