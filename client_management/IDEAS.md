# CCM improvement ideas — feature / process / efficiency

Synthesized 2026-07-08 from: the Survey Ops tracker repo + its session
history, the CMS Slack group DM + adjacent credit threads (Occam period
credits, pricing-scheme discussion), and a code review of the CMS itself.
Focus: credit & contract management, and making CCM speak to SOCC.
Effort: S ≈ ≤1 day, M ≈ 2–4 days, L ≈ 1–2 weeks.

## Found along the way — demo-visible report bugs (fix first)

- **`cyValue` ignores credit-denominated contracts** (`reports.py`): a client
  whose 2026 contract granted 500 credits and $0 shows "$0 contract value" on
  the report leadership sees Friday. Needs a product call: show credit value
  alongside dollar value, or dollars-only with a credits column.
- **`cyRenewal` only looks at contracts DATED this calendar year**: a Dec-2025
  contract renewing Mar-2026 never shows as a renewal. Should be "next
  `renewal_on` ≥ today across all contracts."
- **`parse_money` silently coerces typos to 0** (`helpers.py`): "1O0" saves as
  $0 with no error — silent under-billing at data-entry time.

## Features

1. **Shared identity foundation — `socc_code` / `socc_project_code`** (S,
   keystone). Add `clients.socc_code` (Cl#####, unique) and
   `transactions.socc_project_code` (PR#####) to the schema, show them in the
   UI, deep-link both ways. Today CMS has NO external reference anywhere and
   every sync (incl. our seed/importer) joins by lowercase name — which breaks
   the first time someone renames or merges a client in SOCC (the
   GoldenTree/Goldentree dup we hit is the live proof). Your 7/6 rule — PR/Cl
   codes are the only cross-app keys — becomes real. Everything below keys off
   this.
2. **Renewal Radar** (S). Fix the two report bugs above, then: a renewals view
   bucketed 30/60/90 days out, and a one-click **Renew** that clones the prior
   contract with shifted dates (preview → confirm), linked to its predecessor.
   Renewal is currently a passive date — nothing anywhere acts on it. Most
   demoable single feature for Friday.
3. **"Needs pricing" queue + rate card** (M). The 222 seeded studies sit at 0
   credits. Promote the import-note/mark-reviewed hack into a first-class
   cross-client queue, add a rate card (default credits-per-run by
   cadence/type) with copy-down, and make the bulk editor save only dirty rows
   (it currently re-POSTs every row and re-writes attributions even when
   unchanged). Turns Monday's core sales task into a triaged sweep.
4. **Contract-linked drawdown** (M). Tedi's own design sentence — "when u
   create a study, connect to a contract and automatically subtract" — is not
   actually built: studies debit a client-lifetime pool, so per-contract
   granted/consumed/remaining is uncomputable and 2024 credits are
   indistinguishable from this year's. Add `contract_id` to study transactions
   (default: client's active contract), render utilization bars, and the PDF
   statement reconciles to a specific contract.
5. **Balance health** (S). Trailing burn rate, projected depletion date, and a
   low-balance flag on the balances report + client page — the report page's
   own "coming soon" text literally promises these. Feeds the sales question
   that matters: "which of my clients is about to run dry?"
6. **Ledger integrity pack** (M). First-class adjustment/void transaction
   kinds (corrections currently must be faked as contracts), editor
   attribution on edits (today PATCH leaves `actor_email` = original creator),
   and archive-instead-of-CASCADE on client delete (deleting a client
   currently wipes its entire financial ledger). Sales's first data-entry
   mistake is days away; "how do I fix it" needs an answer that isn't "delete
   the row."
7. **Contract lifecycle status** (M). draft → sent → awaiting signature →
   executed → funded (+ per-currency funds-received). The Coatue international
   blast block happened because only Vineet could see DocuSign/funding state.
8. **CMS balance chip inside SOCC + soft credit gate** (M, the integration
   marquee). SOCC cron snapshots `GET /api/reports/balances` by Cl##### and
   renders "12,400 credits · renews Aug 31" on SOCC client/project pages;
   low-balance and renewal lines join the existing 8am Slack digest. Then port
   SOCC's compliance-gate UX: entering Fielding on a low/negative-balance
   client = block with typed-reason override, logged. Prereq: actually
   implement the documented-but-dead `X-Internal-Auth` service secret (~2–4h).
9. **SOCC→CMS study auto-create** (M). Rerunnable SOCC cron: project goes
   Active → POST a 0-cost "needs pricing" study carrying PR##### and the
   requested-by attribution, idempotent via the code column. Ops already
   births every project in SOCC; sales should only price, never re-type.
   Longitudinal rerun waves each get their own billable study automatically.
   Sequence AFTER the backfill is deduped by code (see Process #1).
10. **AI describe-it entry** (M). Port SOCC's shipped pattern: "Coatue re-upped
    200 credits at $450 through year-end, Alex sold it" → filled contract form
    with the computed delta previewed before commit. Biggest data-entry-speed
    lever for a sales team that's also testing the Edwin builder that week.
11. **Credits-charged calculator with scheme versioning** (L, after the
    pricing decision). Model the pricing scheme as a versioned entity (tiers,
    per-audience rates, longitudinal discount, child-ratio multiplier),
    compute credits per study from inputs, and produce an old-vs-new
    restatement report. Nobody today can answer "how many credits was this
    survey" — you asked twice in Slack.

## Process

1. **Backfill freeze + code-keyed reconciliation gate before Monday.** Three
   writers are about to hit one prod ledger: Tedi's pending backfill, your
   local seed/importer, sales manual entry from 7/13 — with no dedupe key.
   Agree the sequence in the Slack DM: land code columns → ONE code-keyed
   backfill → dry-run diff (create/update/conflict report to you) → then open
   manual entry. 30 minutes of agreement vs weeks of split-ledger cleanup.
2. **Make Friday the pricing-scheme decision gate.** Shanu wants balances
   shown under the NEW scheme ("they have no idea what they signed up for
   previously"); Vineet's decision is pending. Put "which scheme, and do we
   restate history" on the agenda as blocking, and record scheme version per
   contract from day one so the 222-study pricing pass never gets redone.
3. **Pricing ownership RACI + weekly review.** Who prices (the RM), by when
   (N days of a study appearing), who approves exceptions (Shanu), reviewed
   weekly from the needs-pricing queue. Without an owner, 0-cost studies
   become permanently unbilled work.
4. **Financial-edit policy until the code catches up:** never delete or
   overwrite a money row — enter an offsetting adjustment with a note; eyeball
   the computed credit delta before saving a study. SOCC doctrine (audit
   everything, nothing changes silently) as team behavior first.
5. **Retire the Contracts Database Google Sheet.** Jenna's sheet went dormant
   within weeks (#clientservices dead since Oct 27). Import its rows through
   the new importer's Contracts tab, declare CCM the source of truth at the
   teach-in, with a 24-hour entry SLA after DocuSign.
6. **Teach-in kit.** CCM USER_GUIDE + (i)-tooltips pass (your SOCC
   conventions), and two scripted 2-minute walkthroughs — "record a contract",
   "price a study" — as a one-pager. The cadence math (monthly = per-run ×12 +
   setup folded into credits) silently produces wrong ledger entries if sales
   guesses.
7. **Weekly SOCC↔CCM drift check.** Recurring checklist: CMS clients with no
   socc_code, SOCC-delivered projects with no CCM study (silently unbilled),
   0-cost studies >7 days old, negative balances, codes that no longer resolve
   after a SOCC merge/rename. Manual/scripted first, digest-automated later.
8. **Demo framing: "two money vocabularies."** SOCC tracks panel-side cost
   (bids/blasts); CCM tracks client-facing credits. One slide naming the
   distinction + the integration sequence, closing on the "united economics"
   payoff you pitched Shanu 6/23: CCM revenue joined to SOCC cost per project
   = true ROI — the report neither system can produce alone.

## Efficiency

- Auto-create (F9), rate card + dirty-row bulk edit (F3), describe-it (F10),
  and the importer (shipped) together eliminate almost all double entry.
- **One-command demo stack** (S): a single script that boots Postgres, applies
  schema, seeds, smoke-checks the balance math, and launches /ccm — demo
  readiness decoupled from Tedi's backfill, and your iterate loop drops to one
  command.
- **Reconciliation dry-run tooling** (S): the importer's preview is already a
  diff engine; point it at Tedi's backfill and the Contracts sheet to produce
  the conflict report in Process #1.

## Suggested sequence

Before Friday: report-math fixes → Renewal Radar → balance health →
`socc_code` columns → framing slide (all S).
Before Monday: freeze/sequencing agreement, pricing decision, RACI, edit
policy, sheet retirement, teach-in kit.
Weeks after: balance chip + credit gate → auto-create → contract drawdown →
ledger integrity → describe-it → calculator.
