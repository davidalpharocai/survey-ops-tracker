# Deliverables Weekly QA Report — Design

**Date:** 2026-07-15
**Status:** Approved (design), implementing

## Goal

A weekly Slack digest surfacing deliverables-depository health so nothing rots — aging review items, auto-file spot-checks, duplicate/unsorted hygiene, and coverage gaps. Read-only; posts to a dedicated Slack channel.

## Delivery

- **Slack**, weekly, to the new QA channel (`C0BH3SG5Q79`) via a NEW incoming webhook **`SLACK_QA_WEBHOOK_URL`** — separate from daily-digest's `SLACK_WEBHOOK_URL` because incoming webhooks are channel-locked. Human setup (~2 min): create the webhook pointed at that channel, set the env var in Vercel.
- **Cadence:** Mondays 13:00 UTC — `"0 13 * * 1"` in `vercel.json`. Hobby-legal (once/day; see [[survey-ops-tracker-deployment]] cron limit).

## Architecture — thin cron over a testable module

- **`lib/deliverables/qa-report.ts`** (pure, no I/O, unit-tested):
  - `buildQaReport(input, config): QaReport` — takes pre-fetched `deliverables` + `projects` rows + `now`, returns structured findings per bucket + counts.
  - `renderQaReportText(report): string` — Slack mrkdwn, reusing the daily-digest section style + an `escSlack` helper.
- **`app/api/cron/deliverables-qa/route.ts`** (thin): authorize (`CRON_SECRET` bearer or `WEBHOOK_SECRET`), fetch rows via the admin client, `buildQaReport`, `renderQaReportText`, POST to `SLACK_QA_WEBHOOK_URL`, `logSystemEvent`, **always return 200**.
- **`vercel.json`**: add the weekly cron entry.
- **No DB migration** — every check uses existing columns.

## Data the route fetches

- `deliverables`: `id, status, match_method, match_confidence, match_candidates, source, file_hash, project_id, file_name, original_file_name, forwarded_by, created_at, filed_at, deleted_at`.
- `survey_projects`: `id, project_code, project_name, client, deliver_date, project_type, deleted_at` (for coverage).

## The four checks (`QaReport` buckets)

Config (tunable consts): `agingDays = 7`, `lowConfidence = 0.90`, `coverageLookbackDays = 30`, `listCap = 10` (lists longer than this show the first 10 + "+N more").

1. **Aging review queue** — `status='review'`, `deleted_at` null, `created_at` older than `agingDays`. List: file, best-guess client/project (from `match_candidates[0]`), age in days, `forwarded_by`. Sorted oldest-first.
2. **Auto-file spot-check** — `status='filed'`, `filed_at` within the last `agingDays`, AND (`match_method='ai'` OR `match_confidence < lowConfidence`). List: file, project, method, confidence. (Deliberately surfaces every AI-tier filing while the tier is young.)
3. **Hygiene** — (a) **duplicates**: group non-deleted, non-`duplicate`-status deliverables by `file_hash`; any hash with ≥2 rows → flag (file name + count). (b) **unsorted**: `status='unsorted'`, `deleted_at` null.
4. **Coverage + tally** — (a) **coverage gap** (a COUNT + up to 5 examples, not a full list): `survey_projects` with `deliver_date` in `[now-coverageLookbackDays, now]`, `deleted_at` null, `project_type != 'Internal'`, that have ZERO filed (`status='filed'`, `deleted_at` null) deliverables. ⚠️ Framed as an **adoption gap** — it will read high until forwarding-to-depository is the norm, so it's a count-with-examples, not an actionable per-item list. (b) **tally**: count of deliverables filed in the last `agingDays`, grouped by `source` × `match_method`.

## Slack rendering

Header `📋 *Deliverables QA — <date>*`, then one section per **non-empty** bucket with the count in the header, `escSlack` on every data field, and a trailing link to `/deliverables`. If every bucket is empty → `✅ Depository is clean — nothing aging, no dupes, no gaps.` Mirrors `daily-digest`'s section-array approach.

## Behavior / edge cases

- **Always return 200** so Vercel Cron doesn't retry and double-post.
- `SLACK_QA_WEBHOOK_URL` unset → `logSystemEvent` + return the rendered text as a JSON preview (no throw) — same pattern as `daily-digest`.
- Each bucket is computed independently in the pure module; a fetch failure in the route is caught, logged, and returns 200.
- Manual trigger allowed with the webhook secret (for a one-off sanity check).
- No silent caps: any list truncated at `listCap` shows "+N more".

## Testing (vitest, pure module — no network)

- `buildQaReport` fixtures: one case per bucket — an aged review row (flagged) + a fresh review row (not flagged); an AI-filed row + a low-confidence filed row (both flagged) + a high-confidence non-AI filed row (not); two rows sharing a hash (dup) + a unique row; an unsorted row; a recently-delivered project with no filed deliverable (coverage) + one that has a filed deliverable (not); tally counts by source × method — plus an all-clean input → empty report.
- `renderQaReportText`: expected section headers + counts present; `escSlack` escaping holds; all-clean input → the "clean" line.

## Rollout

Build test-first → `vitest` + `build` + `lint` → PR → merge → deploy. **Human setup:** create the `SLACK_QA_WEBHOOK_URL` incoming webhook for the QA channel. Then manual-trigger the cron once (webhook secret) to confirm the digest renders + posts.
