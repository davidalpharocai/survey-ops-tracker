# Email → Project Activity Timeline — Design

**Date:** 2026-07-07
**Status:** Approved (design); pending spec review → implementation plan
**Author:** David + Claude (brainstormed; design pressure-tested by a 5-lens adversarial panel)

## Goal

Automatically keep a clean, chronological log of client/project emails in each
project's **Activity** timeline, populated with no manual effort, with a
post-delivery safety sweep so nothing is missed — while never exposing
confidential (HR / payroll / personal) mail.

## Problem it solves

Today `project_activity` exists and the project page renders it, but it is only
fed by ad-hoc webhooks. Client email lives scattered across captains' inboxes.
There is no automatic, trustworthy, per-project record of "what was said, when."

## Locked decisions (with rationale)

1. **Team-wide, all captains** — not a single inbox.
2. **Privacy-first capture via Gmail-native filters (not inbox scanning).**
   Filtering happens *inside Google*: auto-generated Gmail filters select only
   client-tied mail and forward it out. Mail that isn't tied to a known
   client/contact/survey-ID **never leaves the mailbox**. No client roster is
   ever copied into a script (the script stays "intentionally dumb; all matching
   in the app" — the existing deliverables pattern).
   *Rejected:* central domain-wide delegation (reads all mailboxes incl.
   management), and "script scans the whole inbox, matcher decides what leaves"
   (same broad read scope, spread across N mailboxes — privacy-as-filter becomes
   illusory because content leaves before any server-side match).
3. **Transport = central address + one script.** Per-captain Gmail filters
   forward to a shared `activity@alpharoc.ai` Google Group; ONE backing-inbox
   Apps Script reads that group and POSTs to the app. Chosen over per-captain
   scripts because, once filtering is Gmail-native, confidential mail is
   protected either way — so central wins on maintenance (one secret, no
   per-captain install, no "forgot to install" blind spot, clean offboarding).
4. **Precision-first matching with a review queue.** Auto-log only confident,
   unambiguous matches; everything uncertain goes to a one-click review queue.
   Never silently mis-file (a dirty timeline is worse than a queued item).
5. **Strict privacy + conservative back-fill for unknown mail.** Mail we can't
   tie to a known contact/domain/survey-ID is never captured. When a project is
   later created, previously-queued mail attaches **only** on an explicit
   PR-code or validated survey-ID — never via the fuzzy single-active heuristic.
   Accepted cost: brand-new-client mail before the client exists in the system
   won't back-fill.
6. **Store full email body** (David's call) so it's searchable via the connector
   and self-contained — with a **compact/expandable** UI and an activity-section
   **search-and-jump**. Add a retention / delete-on-offboard policy so stored
   third-party content isn't a forever-liability. Visibility is analyst-only
   (existing RLS; compliance-portal users never see project activity).

## Architecture / data flow

```
Captain's Gmail
  └─ auto-generated Gmail filters (client contact emails + client domains + validated survey IDs)
       └─ forward matching mail → activity@alpharoc.ai (Google Group)
            └─ ONE backing-inbox Apps Script (time-driven trigger)
                 └─ POST /api/webhooks/email-activity  (x-webhook-secret; base64 payload; RFC-822 Message-ID)
                      ├─ dedup on external_id = 'email:' + Message-ID  → 23505 = no-op
                      ├─ direction-aware parse (inbound: match client from From; outbound: from recipients)
                      ├─ server-side matcher (reused, hardened) → confidence + candidates
                      │     ├─ confident single active-operational project → promote to project_activity
                      │     └─ ambiguous / unknown / no project yet → email_inbox (review | pending_no_project)
                      └─ lifecycle gates fuzzy matches by watch window; explicit code/survey-ID always logs
```

## Components

### A. Capture — Gmail filters + one script (mostly reused)

- **Gmail filters**: the app exposes the per-captain filter definition (importable
  Gmail filter XML or a documented set of `from:`/`to:`/`list:` rules) generated
  from: all non-archived `client_contacts.email`, each client's **non-shared**
  email domains, and known survey IDs. Regenerated when contacts/projects change.
  A captain imports their filter set once; new clients extend the filters.
- **Backing-inbox script**: adapt `scripts/apps-script/deliverables-forwarder.gs`
  to read the `activity@` group's backing inbox and POST to the new endpoint.
  Reuse the proven payload/secret/label-on-success pattern. Send the RFC-822
  **Message-ID** (parsed from raw headers), NOT `msg.getId()` (per-mailbox → would
  duplicate a CC'd email once per captain).

### B. Ingest endpoint — `/api/webhooks/email-activity` (new)

- Separate from `/api/webhooks/activity` (which requires a non-null `project_id`
  and cannot hold an unmatched email or a review queue).
- Auth via `x-webhook-secret` (existing `safeEqual` pattern).
- **Direction-aware** (do NOT reuse `ingestEmail`, which is outbound-only —
  rejects non-@alpharoc senders and drops attachment-less mail, so it would
  capture ~zero inbound client replies):
  - External sender → resolve client from the **From** address; `direction=inbound`.
  - Internal (@alpharoc) sender → resolve client from recipients; `direction=outbound`.
- Dedup on `external_id = 'email:' + Message-ID`.
- Runs the matcher, then routes (see D).

### C. Data model

- **New table `email_inbox`** (the review queue + pending store):
  - `id`, `external_id` (unique, = `email:<Message-ID>`),
  - `project_id` (nullable FK), `client_id` (nullable FK),
  - `status` enum: `review | pending_no_project | filed | ignored`,
  - `direction`, `from_email`, `to_emails`, `subject`, `snippet`, `body` (full),
  - `occurred_at`, `gmail_message_id` (per-mailbox, debug), `source='email-timeline'`,
  - `match_candidates` jsonb (for the review UI), `matched_confidence`,
  - `created_at`, timestamps for TTL.
  - RLS: analyst-only, service-role writes (mirror 007/036 pattern).
- **Promote to `project_activity`** on confident match or one-click file: insert a
  row (full `body`, `source='email-timeline'`, `external_id`), then mark the
  `email_inbox` row `filed`. `project_activity` dedups on `external_id` so a
  later duplicate is a no-op.
- **New column `survey_projects.delivered_at`** (timestamptz, nullable): stamped
  when `board_column` transitions to `'Delivery'` (or derived from the most-recent
  audit-log transition into Delivery). Needed because `deliver_date` is a manual,
  often-future/blank planned date and can't drive the sweep.

### D. Matching engine (server-side, precision-first) — reuse + harden

Reuse `lib/deliverables/matcher.ts` tiers, with these required changes:
- **Validated survey-ID tier** (new, high confidence = code-equivalent): extract
  candidate IDs with a word-boundary regex, then **validate against the exact
  known set** from `survey_ids_from_sheet`. Match only on membership → owning
  project. Never substring/regex-only (survey IDs are short and collide).
- **Active-operational gate**: "single active project" is computed with
  `isActiveOperational()` (Open + Active + `board_column != 'Delivery'`). Auto-log
  only when exactly one such project exists for the client. 0 active → review /
  pending; never auto-file onto a Closed/Delivered project. (Fixes `loadMatchData`
  not filtering status/phase/column today.)
- **Contact → multiple clients**: if a contact email maps to >1 distinct client,
  route to review with both as candidates (don't auto-pick the first).
- **Shared-domain contacts**: a contact stored at a shared domain
  (`john@gmail.com`) is downgraded to review unless a second signal (code /
  survey-ID) is present.
- **Roster**: union of `client_contacts` (honor `archived`, skip null emails) and
  `project_recipients`. Document which is authoritative for relevance.
- **Longitudinal/rerun series**: treat a rerun family as one match target —
  prefer the single wave whose watch window is open (newest non-Delivered active
  wave); fall to review only when no code/survey-ID AND two waves are both
  genuinely in-window. (Otherwise longitudinal clients degrade to all-review.)

### E. Lifecycle / watch state machine

Evaluate all windows in a fixed timezone (**America/New_York**, matching the UTC
crons). States per project:
- **Watching** — Open & not in Delivery. Fuzzy matches auto-log here (if they
  resolve to this single active project).
- **Sweep** — within 48h of the Delivery transition (`delivered_at + 2 days`).
  Fuzzy matches still auto-log (post-delivery stragglers).
- **Closed-Watch** — Closed/Hold, or past the sweep window. Fuzzy matches do NOT
  auto-log; they go to review.
- **Rule that overrides all windows:** an explicit PR-code or validated survey-ID
  match ALWAYS auto-logs to that project, regardless of state.
- **`pending_no_project`** items (relevant mail, project not yet created) are
  bounded by TTL (~30–45 days) + a per-client cap, and attach to a newly-created
  project ONLY on an explicit code/survey-ID (never via the single-active
  heuristic — avoids blind back-fill).

### F. Timeline UI + search

- **Compact rows** in the Activity section: subject · participants · date ·
  one-line snippet; click to **expand** the full body, plus an "open in Gmail"
  deep-link (Message-ID).
- **Snippet** strips quoted reply history (de-noise); full body is retained for
  expand + search.
- **Search-and-jump** box scoped to the project's activity (search subject / body
  / participants; jump to the match).
- **Connector**: the MCP `list_activity` read surfaces this content and supports
  search, so "find the email where Coatue approved the budget" works via Claude.
- **Review queue UI**: reuse the deliverables review-queue pattern — a list of
  `email_inbox` rows in `review`, each with candidate projects and a one-click
  "file to PR#####" (or "ignore").

### G. De-noise & hygiene

- Log at **thread granularity** where possible (first message per thread /
  collapse), so "thanks"/OOO/scheduling chatter doesn't bury milestones (the
  project detail surfaces only ~10–20 recent rows).
- Distinct `source='email-timeline'` and `external_id='email:<Message-ID>'` so
  auto-logged email can be filtered/muted/bulk-corrected independently. (Also
  rename the misleading `'make.com'` default on the raw activity webhook.)

## Privacy & security model

- Only Gmail-filter-matched (client-tied) mail ever leaves a mailbox.
- No client roster distributed to scripts (filters live in Gmail; matching in the app).
- Stored content is analyst-only (RLS); compliance-portal users never see it.
- **Retention / offboarding**: define a TTL for `email_inbox` queue rows and a
  deletion path for `project_activity` email rows tied to client/project
  lifecycle (offboard a client → purge its logged email). `project_activity` has
  no `deleted_at` today; add one.
- Webhook secured with `x-webhook-secret` (`safeEqual`), payload size-capped.

## Rollout (phased)

- **Phase 1**: explicit-signal auto-log only — validated survey-ID / PR-code /
  single active-operational project — plus the review queue for everything else.
  Ship, then observe review-queue volume.
- **Phase 2**: enable the fuzzier contact / domain / name tiers once volume is trusted.

## Reused vs. new

**Reused:** Apps Script forwarder pattern; `x-webhook-secret` auth; the matcher
tiers + confidence routing + `describeCandidates`; `project_activity` table +
project-page timeline; `isActiveOperational()`; the deliverables review-queue UX
pattern.

**New:** `/api/webhooks/email-activity` endpoint; `email_inbox` table + RLS;
`survey_projects.delivered_at` column (+ stamp on Delivery transition);
`project_activity.deleted_at`; validated survey-ID matching tier; direction-aware
ingest; auto-generated Gmail filter definitions; activity search-and-jump UI +
expandable rows; review-queue UI for email; connector activity search; retention
job.

## Non-goals / explicitly deferred

- AI/LLM classification of emails (deterministic matching + review queue is
  sufficient and free; revisit only if the queue proves too noisy).
- Loosening the privacy filter to capture unknown-sender mail.
- Central domain-wide Gmail delegation.

## Human setup (one-time)

1. Create the `activity@alpharoc.ai` Google Group + a backing inbox.
2. Install the one backing-inbox Apps Script + set `WEBHOOK_SECRET`.
3. Each captain imports their generated Gmail filter set (app provides it).

## Testing

- Unit: survey-ID validation (membership, no substring); matcher hardening
  (multi-client contact → review, shared-domain downgrade, active-operational
  single-project gate); direction detection (inbound external vs outbound
  internal); Message-ID dedup; watch-state computation (Watching/Sweep/Closed);
  rerun-family target selection; pending→attach only on explicit code.
- Integration: endpoint happy path (confident → `project_activity`), ambiguous →
  `review`, unknown → `pending_no_project`, duplicate Message-ID → no-op,
  promote-on-file.
