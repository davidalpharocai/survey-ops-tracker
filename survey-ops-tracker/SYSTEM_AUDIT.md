# Survey Ops Command Center — System Audit & Backlog

*Generated June 15, 2026 by a 10-dimension code audit (UX, data model, security, performance, reliability, product, code quality, AI, analytics, accessibility). This is the living backlog — check items off as they ship.*

## ✅ Shipped in the first remediation pass (June 15)

- **Closed the cross-tenant RLS leak** — migration 030 locks `project_activity`, `project_bids`, `project_steps`, `project_data_changes`, `project_seen`, and `project_audit` to analysts only (compliance reviewers could previously read them via the REST API). **Run migration 030 in Supabase.**
- **Added survey_projects indexes** — `created_at desc`, `captain_id`, `client_id`, GIN on `co_captain_ids` (migration 030).
- **Fixed board drag-order corruption** — neighbor `sort_order` now computed from the unfiltered set, so dropping a card under an active filter no longer scrambles order for everyone.
- **AI parse hardening** — added `Hold` to the status enum, `stop_reason` handling (refusal / max-tokens), and server-side output validation (enum whitelist, non-negative numbers, scoping-vs-pipeline conflict) before anything reaches the DB.
- **Webhook/cron hardening** — constant-time secret comparison (`safeEqual`), capped activity body/field length, daily-digest now times out + always returns 200 (no retry-double-post) + logs failures, doc-title fetch uses `redirect: 'manual'` (SSRF).
- **UX quick wins** — search now matches Next Steps text (board + list); board shows a "no projects match — clear filters" empty state; cards show urgency in words ("⚠ Overdue", "Due tomorrow") not color alone; removed the dead migration-fallback branch in `useProjects`.
- *(Already in place: `useUpdateProject` has optimistic rollback + an error toast covering every inline edit and the drag.)*

## 🔴 Top remaining recommendations (ranked by leverage)

1. **Recovery safety net** (high · large) — app is system-of-record with no backup/restore; delete is a hard cascade. Add **soft-delete + restore** (a `deleted_at` column + an Admin "recently deleted" view), a nightly logical dump via cron, and a plain-language RECOVERY.md.
2. **Insights page** (high · large) — the biggest gap between data captured and surfaced. The audit log already timestamps every stage move + N change, and bid × N = revenue. Build `/insights`: cycle-time per stage, on-time-delivery %, collection pace vs. deadline, per-captain workload, pipeline value, and **margin** (revenue − spend) per client. Add a margin line to BudgetWidget.
3. **Client/contact normalization** (high · large) — Task 26. Contacts still live in the free-text `client` string (split at render). Add a `client_contacts` table + `contact_id` FK; backfill from the `" - "` suffix. Unblocks per-contact retention and fixes dedup fragility. Salesperson-as-free-text is the same debt.
4. **Predictive pace alerts** (high · moderate) — today's only alert is a noon channel blast that flags "behind" only within 3 days of due. Compute responses/day from audit history → flag projected misses early; group the digest per captain with an escalation tier.
5. **Prevent duplicate client firms at the DB level** (high · moderate) — `clients.name` is byte-exact unique, so dups are prevented only by hardcoded canon maps + scripts. Convert to `citext` + normalized unique index; add a "merge clients" Admin action so David can fold dups without an engineer.
6. **`client` text ↔ `client_id` drift guard** (high · moderate) — the sync trigger only fires on the text column; AI edits / sheet blank-fills can desync them, skewing client stats. Always re-derive `client_id` from the text + add a data-health check.
7. **Auto-assign client codes** (medium · moderate) — `clients.code` has no sequence/trigger (unlike project codes), so in-app clients get NULL codes. Mirror the project_code design with a seeded sequence.
8. **Generic audit trigger + central field registry** (medium · moderate) — the trigger hand-lists ~30 columns, so new ones (e.g. `co_captain_ids`) are silently un-audited. Rewrite generically with `to_jsonb` iteration + a denylist; derive the app's label maps from one `lib/fields.ts`.
9. **Carry filters across Board↔List + unify saved views** (medium · moderate) — each keeps its own filter state/keys; switching tabs drops the filter. Lift into one shared persisted hook.
10. **Regeneratable Supabase types** (high · moderate) — `lib/supabase/types.ts` is hand-maintained and already drifting. Add a `supabase gen types` script + document it in the handover doc.
11. **`middleware.ts` auth backstop** (high · moderate) — **deferred:** a prior deploy constraint ("NO middleware.ts") conflicts with AGENTS.md. RLS (now fixed) is the real boundary; revisit middleware on a preview deploy before prod. Also extract the 4 copied `requireAnalyst` guards into one module.
12. **co_captain_ids integrity** (medium · moderate) — unconstrained `uuid[]` with no FK; deleting a team member orphans IDs. Soft-delete team members now; consider a join table later.
13. **Compliance email resend** (medium · moderate) — a failed reviewer email is unrecoverable (dispatched_at is set before the send loop). Add a "resend" action off the `notification_log` :failed rows.
14. **Project detail "Needs attention" strip** (medium · moderate) — the Overview crams 9+ widgets flat. Add a conditional top strip surfacing only active signals (overdue, waiting-on-us, open steps, pending compliance, survey-ID discrepancy).
15. **Board mobile/keyboard** (high for reach · moderate) — the 7-column board is horizontal-scroll-only (clips Delivery on a laptop, unusable on phones) and cards are click-only divs (not keyboard-reachable). Fall back to the List view below `lg`; make cards real links.

## Cross-cutting themes

- **RLS was the only boundary and it was open where it mattered** — now fixed for the child tables; keep this discipline for every new table.
- **The data to be "incredible" is already captured but never derived** — the Insights page (#2) is mostly surfacing, not new collection.
- **Silent failure is the recurring mode, and the owner can't read logs** — make failures visible (data-health rows, failure emails, sentinel states) wherever they can't be eliminated.
- **Convention-driven correctness won't survive the handoff** — let the DB/framework enforce what rituals currently do (generic audit trigger, generated types, DB-assigned codes, citext dedup).
- **Names that should be entities are still free text** — contacts, salesperson, co-captains. One root behind several findings.

## Angles the audit under-covered (worth a dedicated look)

- Session-expiry UX (a lapsed session could make edits *appear* to save then vanish).
- AI cost/rate-limit ceiling — no per-user budget on the Anthropic endpoints.
- The legacy-sheet reconciliation as a live data-integrity surface (refresh-diff writes the `client` text directly).
- Realtime subscription authz (the RLS fix should cover it — verify the publication after).
- **No error monitoring / cron-health alerting at all** — "the cron silently stopped 3 weeks ago" is currently undetectable.
- Human-entry validation (n_collected > n_target, deliver before launch) in the inline editors, not just the AI path.
