# Deliverables Depository — Phase 2: Email Capture + Review Queue — Design

**Date:** 2026-06-18
**Project:** survey-ops-tracker
**Status:** Approved by David (brainstorming session 2026-06-18)
**Builds on:** Phase 1 (in-app upload — live in production). Spec: `docs/superpowers/specs/2026-06-15-deliverables-depository-design.md`.

## Overview

Phase 2 adds the **email-capture path** to the live deliverables depository. An analyst **bcc's, cc's, or forwards** the outbound client email to `deliverables@alpharoc.ai`; the system auto-files the attachments/links into the right `Client / {Project}_{PR#####}_{date}` Shared Drive folder — or, when the client/project can't be inferred with confidence, stages it in a **Review queue** for one-click resolution. The sender gets a **"Filed ✓"** (or "needs a quick review") reply.

It reuses the Phase-1 building blocks already shipped and tested — `matcher`, `ingest` core (`fileDeliverable`), `dedup`, `persist` (`findDuplicate`), `load` (`loadMatchData`), and the `GoogleDrive` client. The new pieces are the **transport**, the **ingest endpoint**, the **review queue UI + resolve route**, and the **reply**.

## Decisions made

| Question | Decision |
|---|---|
| Capture | **bcc / cc / forward** to `deliverables@alpharoc.ai` (all equivalent — whatever lands is processed) |
| Transport | Free **Google Apps Script** on a backing inbox the Group delivers to → POSTs to the ingest endpoint (no admin, $0) |
| Sender gate | Only messages whose `From` is `@alpharoc.ai` are processed (a client emailing the address directly can't inject) |
| Client signal | The **external (non-alpharoc) recipient** identifies the client (bcc/cc); the forwarded original's recipient for forwards; plus `PR#####` in the subject (strongest) and name match |
| Filing | **Auto-file when confident** (client ≥0.85 + a single project), else **Review queue**; right-client/no-project → `_Unsorted` + flag |
| Reply | "Filed ✓" (client/project/Drive link) or "needs a quick review" (queue link) to the sender, via Resend |
| Dedup | Spans email + in-app (content hash / normalized URL) — unchanged from Phase 1 |
| Schema | **No new migration** — `deliverables` already has `email_subject/from/date`, `gmail_message_id`, `match_candidates`, `status`, `source` |

## 1. Transport — `deliverables@alpharoc.ai` → the app

- `deliverables@alpharoc.ai` is a **free Google Group** (no license seat) set to deliver into a designated **backing inbox** (a Workspace user David picks).
- A ~40-line **Apps Script** bound to that inbox (`scripts/apps-script/deliverables-forwarder.gs` — documented in the repo, runs in Google's Apps Script, NOT part of the Next build): a time-driven trigger (~5 min) queries unprocessed messages (e.g. `label:inbox -label:deliverables-filed`), and for each POSTs `{ from, to, cc, subject, date, messageId, body, attachments: [{ filename, mimeType, base64 }] }` to `/api/deliverables/ingest` with the shared secret (in Script Properties), then applies a `deliverables-filed` label.
- bcc / cc / forward all arrive at the Group → backing inbox → processed identically.
- The script is intentionally dumb and stable; all logic is in the app. Idempotency is enforced server-side (`gmail_message_id`), so a retried run is harmless.

## 2. Ingest endpoint — `app/api/deliverables/ingest/route.ts`

Authenticated with `WEBHOOK_SECRET` (HMAC/bearer, mirroring `app/api/webhooks/activity/route.ts`). Per message:

1. **Idempotency:** if `gmail_message_id` was already processed, no-op.
2. **Sender gate:** proceed only if `from` is an `@alpharoc.ai` address; otherwise ignore (and log).
3. **Itemize:** every non-trivial attachment (SHA-256 hashed) + every deliverable link in the body (existing `extractDeliverableLinks`).
4. **Resolve client + project** via the built `matchDeliverable`, fed the email-path signals (see §3) over `loadMatchData`.
5. **File or queue** (reusing `fileDeliverable` + `findDuplicate`): confident (client ≥ 0.85 **and** a single resolved project) → file into `Client / {Project}_{PR#####}_{date}` (`status='filed'`); ambiguous → stage in `00_Needs Review` (`status='review'`, persist top `match_candidates`); right-client/unknown-project → `_Unsorted` (`status='unsorted'`). Exact duplicates are skipped + linked.
6. **Persist** the row: `source='email'`, `match_confidence`, `match_method`, `gmail_message_id`, `email_subject/from/date`, `forwarded_by`; write a `project_activity` entry when the project is known.
7. **Reply** (§5).

## 3. The matching signal for the email path

Phase 1's matcher resolves a client/project from a sender email + subject/body. The endpoint computes the right inputs for emailed deliverables:

- **Client-email signal** = the first **external** (non-`@alpharoc.ai`) address across `To`/`Cc` — i.e. the client you sent to. For a **forward**, parse the forwarded-message header block for the original recipient. This is passed to the matcher as the email to match on, so the contact-email / domain tiers resolve the **client** (not the internal analyst who is the actual `From`).
- **`PR#####` / `Cl#####`** in the subject or body → tier-1 (strongest signal). Encourage analysts to include it in the subject for a near-certain match.
- **Client/project name** in subject/body → fallback tier.
- **Date** = the original send date (`originalSendDate` for forwards; the message `Date` header for bcc/cc).
- The `matcher` module is **unchanged** — the endpoint just feeds it the recipient-derived email. The AI fallback tier stays Phase 3.

## 4. Review queue — upgrade `app/(app)/deliverables/page.tsx`

The Phase-1 placeholder becomes a working queue:

- Lists `status IN ('review','unsorted')` deliverables: email subject + sender, the file/link, and the top `match_candidates` in plain language — e.g. "Looks like **Coatue → PR00003 — B2B Consumer Tracker**, *Medium* — confirm or pick another." Confidence shown as **High / Med / Low** (not a raw number); `(i)` tooltips; analyst-accessible.
- **Resolve:** pick a candidate (or search client/project) → `POST /api/deliverables/[id]/resolve` → `moveFile` the Drive file from `00_Needs Review`/`_Unsorted` into the chosen `Client / {Project}_{PR#####}_{date}` folder (creating it if needed via the existing folder helpers) → set `client_id`/`project_id`/`drive_folder_id`, `status='filed'`, `match_method='manual'` → write a `project_activity` entry.
- **Dismiss:** soft-delete (`deleted_at`) for non-deliverables that slipped in (e.g. a stray reply).

## 5. "Filed ✓" reply

Via the existing `sendAndLog` (Resend). One reply per processed message, to the `from` (the analyst): lists each item with its client, project, and Drive link; anything staged instead says "needs a quick review" with the queue URL. Logged to `notification_log`.

## 6. Security

- Ingest endpoint authed by `WEBHOOK_SECRET`; the Apps Script holds only the endpoint URL + secret.
- Internal-sender gate (§2) — external senders ignored, so the public-ish `deliverables@` address can't be used to inject files.
- `deliverables` RLS is analyst-only (existing); the resolve route requires an analyst session.
- Attachment/link handling reuses Phase-1 hardening (`assertHttpUrl` URL validation for bookmarks; backslash-then-quote Drive-query escaping).

## 7. Testing

- **Unit (Vitest):** external-recipient extraction (bcc/cc vs forwarded-original parse); attachment/link itemization from a payload; the confident-vs-queue decision; idempotency-key handling; the internal-sender gate.
- **Integration:** the ingest route against mock payloads — confident bcc → `filed`; ambiguous → `review`; duplicate → skipped + linked; link-only → shortcut/bookmark; non-`@alpharoc.ai` sender → ignored. The resolve route → `moveFile` + status flip (DriveClient faked).
- **Component:** the review queue (renders candidates + High/Med/Low; the resolve action calls the route).
- **Manual E2E (before ship):** bcc a real test email with an attachment → auto-filed to the right folder + "Filed ✓" reply received; a deliberately ambiguous one → lands in the queue → resolve → file moves correctly.

## 8. Human setup (David — all free, no admin)

1. Create the **`deliverables@alpharoc.ai` Google Group**; set delivery so messages land in a chosen **backing inbox** (a Workspace user).
2. In that inbox's account, open **script.google.com**, paste the provided Apps Script, set the ingest URL + `WEBHOOK_SECRET` in Script Properties, authorize it, and turn on the ~5-minute trigger.
3. `WEBHOOK_SECRET` is already set in Vercel; no new env vars.

## Out of scope (Phase 3)

- The **weekly QA / dedup report** (cron → Resend digest + a QA page surfacing duplicates, low-confidence auto-files, stuck queue items, anomalies).
- The **AI matcher fallback** (tier 5) to auto-resolve more emailed deliverables and shrink the review queue.
- Reminder / aging emails for stale review-queue items.
