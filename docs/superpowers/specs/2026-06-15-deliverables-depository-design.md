# Deliverables Depository — Design

**Date:** 2026-06-15
**Project:** survey-ops-tracker
**Status:** Approved by David (brainstorming session 2026-06-15)

## Overview

A central depository for **final deliverables sent to clients**, built into the existing survey-ops-tracker app and backed by the existing AlphaRoc **Shared Drive**. Deliverables — file **attachments and/or links** (Occam studies, Edwin, Google Sheets) — are captured two ways: by forwarding the outbound client email to a shared alias, or by uploading on the project page; both flow through one ingest pipeline. Each successful auto-file sends an instant **"Filed ✓"** confirmation to whoever forwarded it. The pipeline resolves which client and project a deliverable belongs to (reusing the Tracker's canonical client/project data and AI), then either **auto-files** it into the right Drive folder or **stages** it in a review queue when the match is uncertain. Every filing is logged in Supabase (audit trail + searchable index) and mirrored to the existing activity log. A weekly cron emails a QA/dedup report so the team can clear duplicates, low-confidence files, and stuck queue items.

The guiding constraints: **$0 in new subscriptions** (everything reuses Vercel, Supabase, Resend, the existing Anthropic key, plus a free Google Apps Script and a free Google Cloud service account), and **never silently misfile** (uncertain items are staged, and detection of duplicates/anomalies is a first-class feature, not an assumption). It is built for the **whole internal team** — any AlphaRoc employee (the `analyst` role, auto-provisioned on login) can forward, upload, resolve queue items, and read the report with **no per-user setup**, and the UI follows the app's tooltip convention so a PM can use it as easily as David.

### End-to-end flow (diagram reviewed in brainstorming session)

```
Forwarded email ──▶ free Apps Script ──┐
                                       ├─▶ /api/deliverables/ingest ─▶ resolve client+project ─▶ confident?
In-Tracker upload ─────────────────────┘      (auth + dedup)            (match · AI · dedup)        │
                                                                                          ┌─────────┴─────────┐
                                                                                       yes│                   │no / unsure
                                                                                          ▼                   ▼
                                                                                  auto-file to Drive     review queue
                                                                                          │             (00_Needs Review)
                                                                                          ▼                   │
                                              Shared Drive: Client / {Project}_{PR#####}_{date} / files  ◀── on resolve, move
                                                                                          │
                                          every filing ─▶ Supabase `deliverables` log + activity log
                                                                                          │
                                            weekly cron reads log ─▶ QA/dedup report ─▶ Resend email + QA page
```

## Decisions made

| Question | Decision |
|---|---|
| Capture | **Both** — forward outbound email to a shared alias (`deliverables@alpharoc.ai`) *and* upload on the project page; one shared pipeline |
| Deliverable forms | **Attachments and/or links** (Occam studies, Edwin, Google Sheets); a link is saved into the folder as a Drive shortcut/bookmark and logged |
| Mailbox | `deliverables@alpharoc.ai` is a **free Google Group** (multi-member, Collaborative Inbox) delivering into a backing inbox where the Apps Script runs — multiple employees can see it, **no new license** |
| Email transport | Free **Google Apps Script** on the backing inbox POSTs each message to the ingest endpoint (no Make.com / no subscription) |
| Routing | **Layered auto-match:** `PR#####`/`Cl#####` code → known contact email → sender domain → client/project name/alias → AI fallback |
| Safety | **Auto-file confident, stage the rest** — uncertain items land in a review queue with one-click resolve; nothing silently misfiled |
| Record | **Drive holds files; Supabase is the index/audit** (`deliverables` table + existing activity log) — "both" |
| QA | **Weekly cron report** of duplicates, low-confidence files, stuck queue items, and anomalies → Resend email + a live Deliverables QA page |
| Build | **Tracker-centric brain** (all logic in the app); free Apps Script transport; free GCP **service account** for server-side Drive writes; **$0/month** |
| Users | **All internal employees** (the `analyst` role = any `@alpharoc.ai` login); built for PM-team self-service, not David-only |
| Folder shape | `Shared Drive / Client / {Project}_{PR#####}_{YYYY.MM.DD delivered} / files`; top-level `00_Needs Review` staging; per-client `_Unsorted` |
| Dedup | Gmail `Message-ID` idempotency + **SHA-256 hash** (files) / normalized **URL** (links); exact dup → skip & link; near-dup → flag, never auto-skip |
| Confirmation | Each auto-file sends a **"Filed ✓" reply** to the forwarder (client, project, folder link); staged items reply "needs a quick review" with a queue link |
| Launch scope | **Forward-going**; historical items can be **manually forwarded** anytime and are dated by the email's original send date (no bulk-import tooling at launch) |

## 1. Drive structure & the client→folder map

The depository is the existing Shared Drive (`DELIVERABLES_SHARED_DRIVE_ID`, currently `0AB_Z5JdTWs9WUk9PVA`). Layout:

```
Shared Drive (AlphaRoc Deliverables)
├─ Balyasny (BAM)/                         ← client folder (resolved by stored ID, never by name)
│  ├─ Q2 Consumer Tracker_PR00112_2026.06.10/   ← project subfolder = name_projectId_dateDelivered
│  │  ├─ 2026.06.10 — Topline.pdf
│  │  └─ 2026.06.10 — Row-level data.xlsx
│  └─ _Unsorted/                           ← right client, project unknown (auto-filed + flagged)
├─ Bank of America (BofA)/
├─ …
└─ 00_Needs Review/                        ← staged items the matcher wasn't sure about
```

**The naming problem is solved by mapping, not renaming.** Today's top-level folders are inconsistently named (`Balyasny (BAM)`, `Bain`, `Iowa`, `Junction.AI`). Routing therefore uses a stored folder **ID** per client, never the display string:

- `clients.drive_folder_id` — new column. **One-time backfill** (`scripts/map-drive-folders.mjs`): list the Shared Drive's top-level folders via the Drive API, fuzzy-match titles to `clients.name`/`code`/aliases (reuse the `CLIENT_CANON` map from `scripts/refresh-diff.mjs`), emit a CSV for David to confirm, then write the IDs. Display-name normalization (`Full Name (CODE)`) is optional/cosmetic and out of scope.
- New clients: on first deliverable (or at client creation) the app creates the folder and stores its ID.
- `survey_projects.drive_folder_id` — new column caching the project subfolder ID once created, so we never re-create or re-search. Subfolder name = `{project_name}_{PR#####}_{YYYY.MM.DD}` (e.g. `Q2 Consumer Tracker_PR00112_2026.06.10`). **The date is derived from the forwarded email** — the original *send* date parsed from the forwarded-message header block when present (correct even if forwarded days later), else the message's own `Date` header. The email is the act of delivery, so this is a more reliable "date delivered" than the manually-kept tracker field. The **upload-only path** (no email) falls back to the tracker's Deliver date, then the upload date. The date is set once by the first deliverable that creates the folder; because routing keys off the stored folder **ID**, the display name can be corrected anytime without breaking anything. Net: every folder is self-identifying and cross-references the tracker via `PR#####`.
- File naming: `YYYY.MM.DD — {original filename}` (date prefix for sort + collision-safety; date = that file's email/upload date). Original name preserved for recognizability. Folder and file formats live in one helper, so they're trivially configurable.
- **Link-deliverables** live in the same project folder as a **Drive shortcut** (Google-native targets: Drive/Docs/Sheets) or a small **bookmark file** (external links like Occam/Edwin), so the folder stays the complete picture of what was delivered.

## 2. Data model

New Supabase migrations following the existing numbered pattern (latest applied is 032 → these are 033+):

```
clients                              -- existing table, ALTER
  + drive_folder_id text             -- Shared Drive folder ID for this client (nullable until mapped)

survey_projects                      -- existing table, ALTER
  + drive_folder_id text             -- cached project subfolder ID (nullable until first filing)

deliverables                         -- one row per filed (or staged/duplicate) file
  id uuid PK,
  client_id uuid FK → clients (nullable until resolved),
  project_id uuid FK → survey_projects (nullable),
  kind enum deliverable_kind ('file','link'),
  drive_file_id text, drive_folder_id text,   -- drive_file_id = the file, or the shortcut/bookmark for a link
  file_name text, original_file_name text,
  file_hash text,                    -- SHA-256 of bytes (null for links)
  source_url text,                   -- original link for kind='link' (Occam/Edwin/Google/…)
  mime_type text, size_bytes bigint, -- null for links
  source enum deliverable_source ('email','upload'),
  status enum deliverable_status ('filed','review','duplicate','unsorted'),
  match_confidence numeric,          -- 0..1
  match_method text,                 -- 'code' | 'contact_email' | 'domain' | 'name' | 'ai' | 'upload_context'
  match_candidates jsonb default '[]',  -- top (client,project,confidence,reason) options for the review queue
  duplicate_of uuid FK → deliverables (nullable),  -- set when status='duplicate'
  gmail_message_id text,             -- idempotency key for the email path
  email_subject text, email_from text, email_date timestamptz,
  forwarded_by text,                 -- who forwarded / uploaded
  filed_by uuid FK → profiles (nullable), filed_at timestamptz,
  created_at timestamptz default now()
```

Constraints/indexes: unique `gmail_message_id` (skip already-processed emails); unique `(file_hash, drive_folder_id)` for files and `(source_url, drive_folder_id)` for links (prevent re-filing the same deliverable to the same folder); indexes on `status`, `client_id`, `project_id`, `filed_at`.

**Staging storage:** files awaiting review live in the Drive `00_Needs Review` folder (not Supabase Storage), so bytes never live in two places. On resolve, the file is **moved** (Drive API parent change) into the correct client/project folder and the row flips to `filed`.

### RLS (critical — mirror the migration 030 lockdown)

`deliverables` is **internal/analyst-only**, exactly like the project child tables locked down in migration 030. External `compliance` portal users must **not** read it via REST. Policy: `analyst` role full read/write; `compliance` role no access; service role full access (server operations). This is called out explicitly because the portal previously had a cross-tenant leak from `using(true)` policies — we do not repeat it.

## 3. Ingest pipeline

Single endpoint `app/api/deliverables/ingest/route.ts`, authenticated with the existing `WEBHOOK_SECRET` HMAC/bearer pattern. Accepts: source (`email`|`upload`), attachment bytes + filename + mime, and context (email headers, or project_id for uploads).

1. **Itemize + idempotency:** if `gmail_message_id` already processed, no-op. Each deliverable in the message becomes an item: every (non-trivial) **attachment** (SHA-256 hashed), plus every **deliverable link** in the body — detected by known domains (`*occam*`, `edwin.alpharoc.ai`, `drive.google.com`, `docs.google.com`) and the AI fallback, ignoring footer/unsubscribe noise.
2. **Trivial-attachment filter (email path only):** skip inline signature images, logos, and tracking pixels below a size/type threshold (configurable). Uploads are explicitly chosen files and are never filtered.
3. **Resolve client + project** (§4) — *skipped for uploads*, which carry `project_id` from page context (`match_method='upload_context'`, confidence 1).
4. **Dedup:** files by `(file_hash, target folder)`, links by `(normalized source_url, target folder)` → if present, write a `duplicate` row linked via `duplicate_of`, don't re-file. Catches the email-vs-upload double-capture automatically.
5. **File or stage:** confident → ensure client/project subfolders exist, then for a **file** upload the bytes (service account), for a **link** create a Drive **shortcut** (Google-native target) or a small **bookmark file** (external); write `filed` row + activity-log entry. Uncertain → stage in `00_Needs Review`, write `review` row with `match_candidates`. Right-client/unknown-project → `_Unsorted`, `unsorted` row, flagged.
6. **Confirm:** the Tracker emails (via Resend) one **"Filed ✓" reply** per forwarded message back to the forwarder, listing each item with its client, project, and Drive folder link; anything staged instead says "needs a quick review" with a queue link. The upload path shows the same result inline.

## 4. The matcher (layered, confidence-scored)

Tiers run in order; each yields a candidate (client, project, confidence, reason). Highest-confidence resolution wins; close ties or all-weak results trigger the AI fallback.

| Tier | Signal | Confidence |
|---|---|---|
| 1 | `PR#####` / `Cl#####` in subject or body | ~0.99 |
| 2 | Sender or original recipient ∈ `project_recipients` / known client contact emails | ~0.9 |
| 3 | Sender email **domain** → firm map (skipped for shared domains: gmail/outlook/yahoo) | ~0.8 |
| 4 | Client name/alias (`CLIENT_CANON`) or project name appears in subject/body | ~0.6–0.8 |
| 5 | **AI fallback** — `@anthropic-ai/sdk` (Sonnet-class, JSON-schema-constrained) given the candidate clients/projects + email context; returns best client_id, project_id (or null), confidence, rationale. Invoked **only** when tiers 1–4 conflict or are all weak (cost control). | varies |

- **Auto-file threshold:** client resolved with confidence ≥ **0.85**. Project resolves within the client by: explicit code → project-name match → single active (non-deleted, open) project for that client → else `_Unsorted` + flag.
- Below threshold, or multiple plausible clients → review queue with the top candidates pre-loaded.
- This is the "information learned from clients/projects" the depository leans on: tiers 2–5 read the same canonical Tracker data (and AI) the app already maintains. Soft-deleted projects (migration 032) are excluded from matching.

## 5. Email transport (free Google Apps Script)

`deliverables@alpharoc.ai` is a **free Google Group** (no license seat) with **Collaborative Inbox** enabled, so multiple employees can see and triage what's arrived. The Group delivers every message into one **backing inbox** (an existing account — e.g. an ops mailbox), where a ~40-line Apps Script runs (native `GmailApp`/`UrlFetchApp` — no Google Cloud project, no OAuth dance, no cost):

- Time-driven trigger every ~5 min: query unprocessed messages (e.g. `label:inbox -label:filed`), POST each (subject, from, date, message-id, body, attachments as base64) to `/api/deliverables/ingest` with the shared secret (in Script Properties), then apply a `filed` label.
- Anyone on the team can forward to the Group; the endpoint accepts only forwards from internal `@alpharoc.ai` senders (the original client email is still read inside for routing).
- Idempotency is enforced server-side by `gmail_message_id`, so a retried run is harmless. The script is intentionally dumb and stable — all logic lives in the Tracker. One-time setup by a Workspace admin.

## 6. In-Tracker upload (internal app)

On `app/(app)/projects/[id]/page.tsx`, an **"Attach deliverable"** action (and a **Deliverables** list on the project page), available to **every analyst**:

- Upload one or more files **or paste a deliverable link** → server computes hash (or normalizes the URL), runs dedup, files straight to the project's `Client / {Project}_{PR#####}_{date} / …` folder (project/client known from context, so no matching).
- The project's Deliverables list shows filed items with name, date, size, source badge (email/upload), and a Drive link. Soft-delete consistent with the rest of the app (`deleted_at`).

## 7. Weekly QA / dedup report

A Vercel cron (`app/api/cron/deliverables-qa/route.ts`, `CRON_SECRET`, ~Monday AM) reads the log and produces:

- **Filed this week** — by client/project, with confidence and source.
- **Exact duplicates skipped** — `status='duplicate'` rows, linked to originals.
- **Possible near-duplicates** — same project, similar filename/size, *different* hash (likely a new version vs. a re-send) with a confidence score; never auto-resolved.
- **Review queue** — `status='review'` items and their age.
- **Low-confidence auto-files** — `filed` rows below a comfort threshold (e.g. < 0.92) for spot-checking.
- **Anomalies** — `_Unsorted` files, clients with no `drive_folder_id`, same content filed to two clients (a routing-error signal), naming oddities.

Delivered as a **Resend digest** to the internal team (a distribution alias, defaulting to all analysts) **and** rendered as a filterable **Deliverables QA page** (`app/(app)/deliverables/qa`) where each row resolves/merges/moves in one click. Resolving a review item moves the Drive file into the correct folder and updates the row.

## 8. Security & cost

- **Google Cloud service account** (free), added as **Content Manager to the one Shared Drive only** (least-privilege). Key in Vercel env (`GOOGLE_SERVICE_ACCOUNT_KEY`, base64). Server-side Drive writes via `googleapis`. This is the single new setup step.
- Ingest endpoint authenticated by the existing `WEBHOOK_SECRET` pattern; the Apps Script holds only the endpoint URL + secret.
- `deliverables` RLS is analyst-only (§2) — external compliance reviewers cannot read it.
- **$0/month:** no new subscriptions. Anthropic usage is pennies (tier-5 fallback only).
- New env vars: `DELIVERABLES_SHARED_DRIVE_ID`, `GOOGLE_SERVICE_ACCOUNT_KEY`, `DELIVERABLES_INGEST_SECRET` (or reuse `WEBHOOK_SECRET`).

## 9. Build phases (each independently shippable/verifiable)

1. **Core:** migrations (`clients.drive_folder_id`, `survey_projects.drive_folder_id`, `deliverables` + RLS); service-account Drive client; ingest endpoint; matcher tiers 1–4; folder/file/link creation (shortcut/bookmark) + dedup; activity-log integration; in-Tracker upload + project Deliverables list; the client→folder backfill script.
2. **Email + review:** the Google Group + backing-inbox Apps Script transport; the "Filed ✓" confirmation reply; the Review Queue UI + one-click resolve (move).
3. **QA + AI:** the weekly cron report (email + Deliverables QA page); the tier-5 AI fallback.

## 10. Usability & access (whole internal team)

The depository is for **every internal employee** — the PM team especially — not just David. The role model already supports this: migration 031 auto-provisions an `analyst` profile for any `@alpharoc.ai` login, and all internal users see everything. Concretely:

- **No per-user setup.** Anyone with a Tracker login can forward to the alias or upload on a project. Nothing is scoped to one person.
- **Plain-language UI.** The Review Queue states its guess in words ("Looks like **BAM → PR00112 — Q2 Consumer Tracker**, medium confidence — confirm or pick another"), shows confidence as **High / Medium / Low** (not a raw number), and resolves in one click. Every control carries an `(i)` explainer per the app's tooltip convention.
- **Discoverable.** A top-level **Deliverables** nav entry leads to the per-project lists, the Review Queue, and the QA page — all team-accessible.
- **Team-wide report.** The weekly digest goes to an internal distribution (defaulting to all analysts / a team alias), readable without prior context.
- **Documented.** `USER_GUIDE.md` gets a "Deliverables" section so the workflow is self-serve, consistent with the team's guide-maintenance practice.

## Error handling summary

- Drive API failure → ingest returns a retryable error; the email path re-POSTs on the next trigger (idempotent); uploads surface a retry toast. Row not marked `filed` until the Drive write succeeds.
- Unmatched client (all tiers fail) → `00_Needs Review` + review queue, never dropped.
- Duplicate forward / double trigger → caught by `gmail_message_id` and `(file_hash, folder)` uniqueness.
- AI fallback error/timeout → degrade to review queue rather than guess.
- Missing client folder → auto-created; missing `drive_folder_id` after backfill → flagged in the weekly report.

## Testing

- **Unit (Vitest):** matcher tiers + confidence aggregation; threshold/auto-vs-stage logic; project-resolution rules (code/name/single-active/_Unsorted); filename + folder-name builders; deliverable-link detection + URL normalization; SHA-256/URL dedup and idempotency.
- **Integration:** ingest endpoint against a mocked Drive client — file path, dedup skip, review staging, message-id idempotency.
- **RLS / access:** a `compliance` user cannot read `deliverables` via REST; **any** `analyst` (not just David) has full read/write and sees the same queue/report; analyst access intact (mirror the 030 lockdown tests).
- **Manual E2E before ship:** forward an email → auto-filed to the right folder + logged + "Filed ✓" reply received; ambiguous email → lands in review queue → resolve → file moved; duplicate (forward + upload same file) → second skipped & linked; a **link-only** deliverable (e.g. an Edwin link) → shortcut/bookmark created in the folder; weekly report renders with a seeded duplicate and a stuck queue item.

## Out of scope (phase 2+)

- Writing the Drive link back to the legacy sheet's "Deliverable" column (could reuse the existing project-id mapping-sheet flow).
- **Bulk/automated** backfill of historical deliverables — but **manual** historical forwarding works from day one (each is dated by the email's original send date).
- Slack alerts for the QA report (Resend + page first).
- Auto-classifying deliverable *type* (topline vs. row-level vs. case study) or detecting "final vs. draft" — we trust the human's choice to forward/upload.
- Client-facing access to the depository (internal only for now).
- Display-name normalization of existing client folders.
