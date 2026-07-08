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

## Review & approve queue (core)

The safety valve behind the precision-first decision: **uncertain email never
touches a project timeline until a human approves it.**

- **Where:** a dedicated **Email Review** view in the app (its own queue, mirroring
  the existing Deliverables review-queue UX). It is global, not per-project —
  uncertain emails often can't be tied to a project yet (the project is exactly
  what's unclear), so they can't live on a project page.
- **What lands here:** anything that isn't a confident, unambiguous single-project
  match — e.g. a recognized client with 2+ active projects, a known contact who
  maps to multiple clients, or a shared-domain contact match without a second
  signal. (Confident PR-code / validated survey-ID / single-active-project matches
  skip the queue and auto-log directly.)
- **What a reviewer sees per item:** sender, recipients, subject, date, a snippet
  (expand for the full body / open in Gmail), and the app's **best-guess candidate
  project(s)** with the matched signal shown (e.g. "contact jane@acme.com → Acme,
  2 active projects — pick one"), or "no confident match."
- **Actions (one click):** **File to PR#####** — promotes the email into that
  project's activity timeline (candidates shown as chips + a search box to pick any
  project); **Ignore** — drops it, won't resurface; optionally **Not relevant** —
  drop and suppress that sender/thread going forward.
- **Who reviews:** any analyst can triage (items aren't locked to a captain, since
  the captain is derived from the project, which is what's uncertain).
- **Bounded:** items nobody files expire after the retention TTL (~30–45 days) so
  the queue can't rot. A small pending-count badge surfaces it (optional later: a
  daily digest of pending items).
- **`pending_no_project`:** relevant mail whose project doesn't exist yet waits here;
  when a matching project is created it auto-files **only** on an explicit PR-code /
  survey-ID, otherwise it stays for one-click manual filing.

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

- **Phase 1**: **inbound client mail only** (Gmail auto-forward fires on incoming
  mail, not a captain's own Sent — see Review resolutions), with **explicit-signal
  auto-log only** — validated survey-ID / PR-code / single active-operational
  project — plus the review queue for everything else. Ship, then observe queue volume.
- **Phase 2**: enable the fuzzier contact / domain / name tiers once volume is trusted.
- **Later (optional)**: an explicit outbound mechanism (or a manual "cc activity@" habit)
  if standalone outbound capture is wanted beyond the quoted history in replies.

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

1. Create a **dedicated free Google Group `activity@alpharoc.ai`** (groups.google.com
   — a Group, NOT a mailbox or paid seat; ~2 min, no admin), separate from
   `deliverables@`. Posting → "anyone in the organization" (external senders are
   ignored by the app). Add a Workspace user as a member with "each email"
   delivery so messages land in a backing inbox.
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

## Review resolutions (final decisions from the 2026-07-07 spec review)

A 4-lens review found the architecture sound (`ready-with-changes`) but flagged
gaps to close before planning. These resolutions govern the implementation plan.

**Scope — inbound-first (must-fix).** Gmail filter "forward to" fires only on
*incoming* mail, so a captain's own Sent mail is NOT auto-captured. Phase 1
captures **inbound client mail**; since replies quote the prior thread and we
store the full body, outbound context is preserved. Automatic outbound capture is
out of scope (optional later: explicit mechanism or a manual "cc activity@" habit).

**Header transport — validate before building (must-fix).** Dedup
(`external_id='email:'+RFC-822 Message-ID`) and inbound client resolution
(original `From`) assume those headers survive filter→Group→backing-inbox. Groups
can rewrite `From` (DMARC) and GmailApp has no Message-ID accessor. **Plan task #1
is a spike**: forward one CC'd email from two accounts through `activity@` and
confirm (a) both backing-inbox copies share one Message-ID and (b) the original
From survives. Extract via Gmail advanced service `Users.Messages.get(format=metadata)`
or `getRawContent()`+`/^Message-ID:/im` (no attachment download). If Message-ID/From
can't be resolved → route to review. Disable Group From-munging if present.

**delivered_at (must-fix).** Add `survey_projects.delivered_at timestamptz`. Stamp
via a dedicated **BEFORE UPDATE trigger** when `OLD.board_column <> 'Delivery' AND
NEW.board_column = 'Delivery'` (the existing audit trigger is AFTER UPDATE and
can't set NEW). **One-time backfill** from `project_audit` (field='board_column',
new_value='Delivery', latest changed_at). Already-Delivered projects left NULL →
treated as past-sweep → fuzzy matches route to review.

**email_inbox DDL (must-fix).** Named enum type `email_inbox_status` =
{review, pending_no_project, filed, ignored}; `direction` text, `from_email` text,
`to_emails text[]`, `subject/snippet/body text`, `occurred_at timestamptz`,
`gmail_message_id text`, `source text default 'email-timeline'`,
`match_candidates jsonb`, `matched_confidence numeric`, `created_at timestamptz
default now()` (drives TTL). **Partial-unique index on `external_id`**; indexes on
status, project_id, client_id, occurred_at. RLS = the **036/045 split** (revoke
anon/authenticated; service_role full for ingest; analyst select+update for triage).

**Matcher = per-candidate gate, not a pre-filtered set (must-fix).** Load **all
non-deleted projects** so exact PR-code / validated survey-ID can match a project
in ANY state (the "always auto-logs" override must work for Closed/Delivered).
Apply `isActiveOperational()` only to **downgrade the fuzzy tiers** (single-active
/ domain / name) to review. This is **new work, not reuse**: extend `loadMatchData`
to select status/phase/board_column; source contacts from a **union of
`client_contacts` (archived=false, non-null email — authoritative for "client-tied"
relevance, since the Gmail filters are built from it; wins on conflict) and
`project_recipients`**; and **rewrite the routing layer** (`confidence.routeMatch`
emits Drive statuses — the email pipeline needs its own {auto-log, review,
pending_no_project} routing).

**Survey-ID tier (must-fix).** `survey_ids_from_sheet` is a single free-text
string: split on comma/whitespace/newline, trim + case-fold, blanks = no signal.
Extend `loadMatchData` to select it and build a validated `surveyId → projectId`
map. Match only on **exact membership**; an ID mapping to >1 project → review (or
defer to the rerun newest-in-window rule). Never substring-match a survey ID.

**Cross-pipeline dedup (must-fix).** A deliverable email must not log twice
(deliverables inserts `external_id='deliverable:<id>'`, this pipeline
`email:<Message-ID>`). Before inserting an email-timeline row, **skip if a
`project_activity` row already exists for the same Message-ID**. The two Apps
Scripts use **separate backing inboxes / disjoint labels**. (Chosen over relying on
a "never cc both" habit.)

**Search (should-fix, net-new).** `listActivity`/`getProjectDetail` select no body
and take no search term today. Add a `pg_trgm`/tsvector GIN index on
`project_activity(subject, body)`; extend both reads to search; **bound result
size**. Store the **full raw body** (for expand) but **index a quoted-history-
stripped body** for search (avoid O(n²) dup hits). Connector `list_activity`
returns **snippets by default with on-demand full-body fetch** — so full bodies are
searchable via MCP without dumping every body inline.

**Storage & promote (should-fix).** New endpoint has its own body-size cap; the
promote path writes the full body **without** the 20k clip. Promote is two-step and
**crash-safe**: activity-insert 23505 = already promoted (still flip the row to
`filed`); email_inbox-insert treats 23505 as success (concurrent CC'd forwards
no-op, not 500). Add `project_activity.deleted_at` and `.is('deleted_at', null)` to
**every** activity read.

**Threading (should-fix).** Log **every** message (dedup by Message-ID); collapse
by thread in the **UI only**. Optional later: a `thread_key` (References/In-Reply-To
root) for server-side collapse. **Drop the "Not relevant/suppress sender" action
from Phase 1** (no data model) — revisit with a suppressed-senders store.

**Retention (should-fix).** `/api/cron/email-retention` (CRON_SECRET-gated, in
vercel.json): expire `email_inbox` rows older than **45 days** (by created_at).
Fire `pending_no_project → attach` from a scan keyed off project creation (explicit
code/survey-ID only). On client offboard/soft-delete, purge that client's
`project_activity` email rows after a short grace.

**Human-setup additions (should-fix).** Each captain must add + **verify**
`activity@alpharoc.ai` under Gmail → Forwarding before importing filters (imported
filters silently drop forwards to unverified addresses); confirm the Workspace admin
console permits auto-forwarding. Filter **regenerate/re-import lifecycle**: Gmail
import doesn't dedupe → delete-old-then-reimport; build the filter from
contact/domain criteria (validate survey IDs **server-side**, since Gmail
has-words is substring-only and would over-forward); chunk large sets under Gmail's
per-filter and total-filter caps.

**Inbound attachments (should-fix).** Not stored by this feature (body-centric);
attachments worth filing go through the existing deliverables path. The activity
forwarder does not download attachments.

**Nits.** Cite RLS pattern as **036/045** (not 007/036). Keep the `source='make.com'`
rename **out** of this feature (don't touch the live raw webhook). Relabel
"Reused vs new" honestly — matcher routing, `loadMatchData` contact source, and
connector search are new work. Human-setup wording: external *posts* to the Group
are rejected, but the original external From *inside* a captain-forwarded message is
exactly what inbound capture reads (not a contradiction). Temper "nothing missed":
contact/domain-only pending mail needs one-click manual filing — surface
`pending_no_project` items on the new client/project page. (Verified OK:
`project_activity` RLS is already analyst-only per 030; `isActiveOperational` =
Open + Active + board_column ≠ 'Delivery'.)
