# CCM — future-proofing roadmap to an established-company system of record

Synthesized 2026-07-08 from web research on how mature companies build
credit/usage billing, contract lifecycle, financial ledgers, SaaS platform
plumbing, and RevOps analytics — grounded against CCM's actual code. Pairs
with [IDEAS.md](IDEAS.md) (near-term tactical ideas); this doc is the
strategic, "put the time in now so retrofitting later doesn't screw us" view.

## The one idea that matters most

Every mature credit/usage-billing platform (Stripe Billing credit grants,
Metronome, Orb, Lago, m3ter) converged on the **same** two primitives, and
CCM has neither yet:

1. **Credits are not a single number — they are dated GRANTS.** A contract
   should create one or more credit *grants*, each with its own amount,
   effective date, expiry, priority, cost basis, and scope. Studies draw
   down grants in a **deterministic order** (priority → soonest expiry →
   cost basis → FIFO). Today CCM stores one scalar balance = SUM of deltas,
   which can't express expiry, rollover, per-contract utilization, or
   revenue recognition.
2. **The ledger is append-only and immutable.** You never edit or delete a
   money row; corrections are **new reversing/adjustment entries** that
   reference the original. Balances are computed by replaying the log.
   Today CCM edits studies/contracts in place (PATCH), hard-deletes them,
   and a client delete CASCADE-wipes the entire ledger.

Everything else is downstream of getting these two right. They are also the
**most expensive things to retrofit** — every in-place edit made before the
ledger is immutable is history you can never reconstruct.

## Tier 1 — Foundation (cheap now, severe to retrofit; do around launch)

| # | Item | Effort | Retrofit risk if delayed |
|---|------|--------|--------------------------|
| F1 | **Immutable append-only ledger** — block destructive PATCH/DELETE of money rows; add `adjustment`/`void`/`reversal` kinds that write new rows via a `reverses_transaction_id`; record who/when/before-after. | L | **Severe.** Any pre-launch in-place edit is unrecoverable; the mutable-row habit, once learned Monday, is what you fight forever. |
| F2 | **Decimal money end-to-end** — storage is already `DECIMAL`; stop casting to `float()` in reports/parsing; serialize amounts as strings; fix scale/rounding (USD 2dp, credits 2–4dp). | M | Medium-high — JSON shape changes; all consumers move together (trivial now, painful once SOCC + exports depend on it). |
| F3 | **Stable external keys `socc_code`/`socc_project_code`** (the keystone) — stop joining by lowercased name (the GoldenTree/Goldentree dup proves it breaks). Consider opaque public IDs for the API. | S | **High.** Every integration/backfill hard-codes name-matching; unwinding a name-keyed backfill after 3 writers hit prod is the "weeks of cleanup" risk. |
| F4 | **Contract-linked drawdown** — nullable `transactions.contract_id` so a study draws down a specific contract (Tedi's "connect a study to a contract" design, not actually built). | M | Medium — backfilling which contract 222 historical studies drew from only gets harder with volume. |
| F5 | **Archive/soft-delete, not `ON DELETE CASCADE`** — deleting a client today wipes its whole ledger; one mis-click in week 1 is catastrophic. | S | Medium — any ledger destroyed before this ships is gone. |
| F6 | **Versioned migrations (Alembic)** — replace "re-apply schema.sql on every cold start"; can't express column changes/renames/backfills and cold starts race on DDL. | M | Medium — drift accumulates the longer additive-only edits pile up. |
| F7 | **Real roles model** — replace the `CCM_ADMIN_EMAILS` allowlist with admin / editor(RM) / read-only; scope financial writes. Unblocks the planned sales view. | M | Medium — auth checks are spread across every router; defining 2–3 roles early makes future roles additive, not a rewrite. |

## Tier 2 — Scale (established-company table stakes)

- **S1 Google Workspace SSO** (federate Cognito → Google OIDC; retire the dev
  email header). *Skip SCIM* — pointless at ~10–20 users.
- **S2 Versioned read API + webhooks + real service auth** (implement the
  dead `X-Internal-Auth`; balances/transactions by code; `balance-changed`,
  `low-balance`, `renewal-upcoming` events via a transactional outbox). This
  is the prerequisite for every SOCC integration. Version from v1.
- **S3 Idempotency keys** on write endpoints — so SOCC auto-create and CSV
  re-imports can't double-book.
- **S4 Contract lifecycle status** — draft → sent → awaiting signature →
  executed → funded, + per-currency funds-received (the Coatue block).
- **S5 Rate card + versioned pricing scheme** — default credits-per-run by
  cadence/type, a cross-client "needs pricing" queue, and scheme-version
  stamped on each contract so the pricing pass is never redone.
- **S6 Observability + SLOs** on the balance API SOCC will depend on.
- **S7 Backups/PITR + a *tested* restore drill** + retention policy.
- **S9 Reporting layer** off a read replica / materialized view — Renewal
  Radar (30/60/90), Balance Health (burn rate, projected depletion,
  low-balance flags). The report page already promises these.

## Tier 3 — Differentiators (compounding advantage, once F3 + S2 exist)

- **D1 Unified economics** — join CCM revenue ⋈ SOCC cost by PR#####/Cl##### =
  **cost-per-deal and margin per project** (your 6/23 "united economics"
  pitch; the report neither system can make alone).
- **D2 CCM balance chip + soft credit gate inside SOCC** (reuse SOCC's
  shipped compliance-gate UX).
- **D3 SOCC→CCM study auto-create** (ops births the project; sales only
  prices).
- **D4 AI describe-it entry** (port SOCC's NL→form pattern).
- **D5 Forecasting** — depletion dates, at-risk clients, renewal revenue.
- **D6 Client-facing statement portal** — last; only credible once the
  ledger is immutable, money ties out, and roles exist.

## Do these THREE first (all small, hard deadlines)

1. **F3 `socc_code`/`socc_project_code` columns** — must exist *before*
   Monday's backfill so the one code-keyed reconciliation has a real join
   key. Cheapest item, blocks the worst cleanup.
2. **F1 minimum-viable immutability** — block destructive money-row edits +
   add adjustment/void kinds *before* manual entry opens Monday, so the team
   never learns the mutable-row habit and no billing history is silently lost.
3. **F5 archive-not-CASCADE** — tiny change, removes the "delete a client
   wipes its ledger" foot-gun before real data lands.

(The three demo-visible report bugs — cyValue, cyRenewal, parse_money — are
already fixed, so Friday's report is sound.)

## Recommended sequence (around the two real deadlines)

- **Phase 0 — before Friday** (all S, demo-safe): F3, F5, F2.
- **Phase 1 — around Monday's backfill**: F1 guardrails; run ONE code-keyed
  reconciliation (Tedi's backfill + Contracts sheet + seed) through the
  importer's diff engine before opening manual entry; lock Friday's pricing
  decision in as scheme-version metadata.
- **Phase 2 — foundation completion (2–4 wks)**: F1 full reversal + in-DB
  history, F4, F6, F7.
- **Phase 3 — scale, ordered by what SOCC needs**: S2 + S3 → S4 → S5 → S7 →
  S6 → S9 → S1.
- **Phase 4 — differentiators**: D2 → D3 → D1 → D4 → D5 → D6.

## Deliberately NOT doing (over-engineering at AlphaROC's scale)

- **SCIM provisioning** — SSO yes, SCIM no (~10–20 internal users).
- **Full double-entry general ledger / TigerBeetle / chart of accounts** — an
  append-only immutable log with reversal entries (F1) gives the audit
  benefits without building a bank's accounting engine.
- **Microservices** — one FastAPI + RDS is correct; the "backend owns data,
  thin frontend" seam is already right.
- **Multi-currency FX engine** — credits + USD is the whole world;
  per-currency funds-received (S4) covers the international case.
- **Event-sourcing-everything + Kafka + CQRS infra** — aggregation-computed
  balances are fine at this volume; reporting is a materialized view.
- **Kubernetes / always-on compute** — Lambda + RDS fits bursty internal load.
- **Crypto hash-chained "blockchain" ledger** — immutability by policy +
  append-only + the audit stream is sufficient; tamper-proofing is theater here.
- **BPM/workflow engine for contracts** — a status enum + logged transitions
  beats a heavyweight approval engine.
- **Real-time CDC streaming to SOCC** — a cron snapshot + webhooks is enough;
  sub-second balance freshness has no business value.
