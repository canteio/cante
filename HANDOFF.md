# Handoff — where things actually stand

`CLAUDE.md` describes the code exhaustively and a new session reads it
automatically. This file covers what CLAUDE.md deliberately does not: the
business state, the decisions already made, and what is in flight right now.

Written 18 Aug 2026. If the dates below are weeks old, ask before trusting the
"in flight" section.

---

## The one-line state

**The software works and the production migration is implemented, but the remote data import still requires the local Supabase secret.** The local ledger currently has 211 findings, 12 alerts, 18 conversations, 51 chat messages, 6 memories, and 2 documents.

The bottleneck has not been engineering for some time.

---

## In flight right now

Setting up the scheduled check on a **second Mac** (an always-on machine) so the
pilot can start.

Done:
- `cante.db` copied across (db + `-wal` + `-shm` together)
- `.env` created with Telegram credentials, `chmod 600`, gitignored

Remaining:
1. Get the current bot token from @BotFather (`/mybots` → API Token) — an
   earlier token was revoked and `.env` briefly held the dead one
2. Press **Start** on the bot in Telegram, or it cannot message you
3. `npm run check:scheduled -- --verify` → want `Telegram OK — bot @name`
4. `npm run check:scheduled` — full dress rehearsal, real message to the phone
5. LaunchAgent at `~/Library/LaunchAgents/ai.cante.check.plist`, then
   `launchctl load` + `launchctl start` (test immediately, don't wait for 07:00)
6. `sudo pmset -a sleep 0` and `pmset repeat wakeorpoweron MTWRFSU 06:55:00`
7. Healthchecks.io ping URL into `.env` as `CANTE_HEARTBEAT_URL`

**The always-on Mac owns `cante.db` from now on.** Do not run checks on both
machines — divergent seen-logs mean the customer gets the same regulation twice.

---

## Decisions already made (don't relitigate)

| Decision | Why |
|---|---|
| Mac + launchd, **not** GitHub Actions | Actions can't use the local Claude Code login (breaks rule 1) and runners are ephemeral, which destroys `cante.db` and the seen-log |
| Vercel for the authenticated app, not the daily runner | Supabase is the deployed system of record. The long-running source check remains on the Mac and syncs verified results after each run. |
| Telegram for the **operator**, WhatsApp for the customer | Indonesian businesses live on WhatsApp; the Business API needs Meta verification and per-message fees, which don't belong in a pilot |
| Secrets in `.env`, loaded by `scripts/load-env.ts` | A LaunchAgent inherits no shell environment; without the loader a scheduled run silently loses the token and marks alerts `skipped` |
| Not export-only | `sideOfTrade` gates the cross-border packs. All 13 Indonesian sources and 29 of 52 US sources apply to a domestic-only factory |
| Hosted API is approved for deployed chat | `lib/llm/api.ts` supports OpenAI or Anthropic. The local check still defaults to the CLI; Vercel uses `CANTE_LLM=api` and locks the selector. |

---

## The standing rule

> **No new modules under `lib/` until someone has paid.**

Exceptions: `lib/llm/api.ts` (if rule 1 is resolved), anything in `scripts/`,
and bug fixes to code a real customer is touching.

This exists because roughly 6,000 lines were written across catalogue, tariff,
documents, substances, classification and delivery — all good, all tested, none
of it ever holding real customer data. If a new session is asked to build a
feature, check this rule first and say so.

---

## What the product is, in one paragraph

A robot that reads government websites every morning and tells one factory owner
whether any new rule affects their business. Out of 211 regulations read, it
dismissed 188 as irrelevant and surfaced 21. That ratio is the product. Its
distinguishing property is that it reports what it *could not* check — failed
feeds, unmonitored tracks — instead of showing green.

---

## The market, briefly

> Full analysis — competitor evidence, differentiation, and TAM with
> verified-vs-assumed labels — is in `market.md` (researched 20 Aug 2026).
> That file supersedes the pricing and positioning notes below where they
> disagree; the $500/month target in particular is revisited there.

- **Big platforms** (Descartes, E2open, CargoWise) — customs filing for large
  importers. Not competitors; losing there costs nothing.
- **Specialists** (Assent = materials/BOM, Quickcode = classification) — sold to
  companies that have a compliance manager.
- **Monitors** (Onyx) — closest analogue.

Published pricing where it exists: GingerControl ~$150/mo, ComplyAdvantage ~$99/mo,
ImportGenius from $149/mo, Shipping Solutions $1,199–9,999, Descartes Visual
Compliance $3,000/user/yr. Assent and E2open don't publish — enterprise quote.

**The market is barbelled**: point tools at $99–250/mo, enterprise at $20k+/yr,
nothing in between. That gap is the wedge. **Target price: $500/month.**

**The positioning line:** "If you have a compliance manager, buy Assent. I'm for
companies where it's nobody's job."

**The honest limit that must be stated in every sales conversation:** Cante
catches rules that *change*. It does not audit whether you are already
non-compliant with a rule published years ago. Saying this first wins more
meetings than any feature.

---

## Next actions, in order

1. Finish the scheduled-check setup (above)
2. Domain + email on that domain + a one-page site — a gmail cold email about
   compliance reads as a scam, and this is a ~$20, few-hours fix
3. **Send one message to one company.** Not the list — one.
4. 14-day pilot: deliver every alert by hand, including the quiet days
5. Ask for money on day 15

---

## Where the rest lives

- **Market, competitors, TAM:** `market.md`
- **Plan (30 days to first revenue):** https://claude.ai/code/artifact/00a4c1ff-fe52-4eb7-b8cc-755f6dedd8ae
- **US lead list (28 real importers + method):** https://claude.ai/code/artifact/e2595400-e357-4a54-b431-5e7ca69392de
- **Code, sources, verified-vs-assumed claims:** `CLAUDE.md`
- **Scope and sequencing:** `plan.md`
- **Source reliability:** `readme.md`
