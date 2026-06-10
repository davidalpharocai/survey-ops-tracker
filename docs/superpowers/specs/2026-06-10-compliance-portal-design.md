# Client Compliance Portal — Design

**Date:** 2026-06-10
**Project:** survey-ops-tracker
**Status:** Approved by David (sections reviewed individually in brainstorming session)

## Overview

A client-facing compliance portal added to the existing survey-ops-tracker app. AlphaRoc analysts upload a questionnaire file on a project; Claude parses it into structured questions; the client's compliance team is emailed a magic link to a scoped portal where they review the questions (with an open-text-only filter), then approve or reject. On approval, AlphaRoc recipients are notified and the survey can launch. On rejection, the analyst revises and resubmits a new version.

This is **wave 1 (questions review)** of a two-wave workflow. Wave 2 (results/answers review after fielding) and survey-tool API ingestion are explicitly out of scope but the data model is built to accept them.

### Full target workflow (for context)

1. Analyst submits question list to portal → compliance notified ✅ this build
2. Compliance reviews questions (open-text filter) → approves/rejects ✅ this build
3. On approval, AlphaRoc list notified → survey starts ✅ this build (notification)
4. Survey results ready → compliance notified — *phase 2*
5. Compliance reviews and approves results — *phase 2*
6. AlphaRoc list notified, outputs sent to analyst — *phase 2*

## Decisions made

| Question | Decision |
|---|---|
| Question source | File upload now (.docx/.xlsx/.csv/.pdf); survey-tool API later |
| Question parsing | Claude (via existing `@anthropic-ai/sdk`) extracts structured questions |
| Open-text detection | Claude flags; explicit "open end" callouts and **AI follow-up questions are always open-text** |
| Analyst preview | Yes — analyst confirms/corrects the parsed questions before sending to compliance |
| Reviewers | Client's own compliance team (external), scoped strictly to their client |
| Portal access | Magic-link email lands on the submission; portal also shows full queue + history |
| Approval granularity | Approve/reject on the whole submission, with optional note (note expected on reject) |
| Revision loop | Analyst revises and re-uploads; versioned submissions (v1, v2, …) |
| Email | Resend |
| Recipients | Per-project recipient lists (compliance contacts + AlphaRoc notify list) |

## 1. Data model

New Supabase tables (new migrations following the existing numbered pattern):

```
clients
  id uuid PK, name text, created_at

survey_projects                -- existing table, ALTER
  + client_id uuid FK → clients (backfilled from existing free-text `client` column)

profiles                       -- one row per auth user
  id uuid PK = auth.users.id, email, full_name,
  role enum profile_role ('analyst','compliance'),
  client_id uuid FK → clients (null for analysts),
  created_at

question_submissions           -- one per review round (version)
  id uuid PK, project_id FK → survey_projects,
  version int (unique per project),
  status enum submission_status ('pending_review','approved','rejected'),
  source_file_name text, source_file_path text (Supabase Storage),
  submitted_by uuid FK → profiles, submitted_at timestamptz,
  reviewed_by uuid FK → profiles, reviewed_at timestamptz, review_note text,
  created_at

questions
  id uuid PK, submission_id FK → question_submissions,
  order_num int, text text,
  type enum question_type ('open_text','single_select','multi_select','scale','other'),
  is_open_text bool, is_ai_followup bool,
  section text, answer_options jsonb default '[]'

project_recipients
  id uuid PK, project_id FK → survey_projects,
  email text, name text,
  role enum recipient_role ('alpharoc','compliance')

notification_log
  id uuid PK, submission_id FK, recipient_email text,
  template text, sent_at timestamptz, resend_id text
```

Storage: private `questionnaires` bucket in Supabase Storage for uploaded source files.

### RLS

Replaces today's "any authenticated user reads/writes everything":

- **Analysts** (`profiles.role = 'analyst'`): full read/write on all tables (current behavior preserved).
- **Compliance** (`profiles.role = 'compliance'`): read `survey_projects`, `question_submissions`, `questions`, and their own `profiles` row **only where the project's `client_id` matches their `client_id`**; may update a submission's `status`/`reviewed_by`/`reviewed_at`/`review_note` only for their client and only when status is `pending_review`; no insert/delete anywhere. Compliance reads of `survey_projects` go through a `portal_projects` view exposing only safe columns (id, project_name, client_id, key dates) so internal fields like budget and spend are never readable by external users, even via the API.
- Storage bucket policy mirrors the same scoping for source-file downloads.
- Service role retains full access (server-side operations).

## 2. Access & auth

Two route groups, one app:

- `app/(app)/...` — internal (analysts), existing, unchanged except the new submission panel.
- `app/(portal)/...` — new client portal for compliance users. Minimal layout: queue, review pages, history. No internal navigation.

Routing rules (enforced in layout server components, consistent with existing server-side auth in layout):

- On login, read `profiles.role`: `analyst` → internal app, `compliance` → `/portal`.
- Compliance users hitting internal routes are redirected to `/portal`; analysts hitting `/portal` are redirected to the internal app.
- RLS is the real security boundary; routing is UX + defense in depth.

Provisioning: compliance users are **invited only** (no public signup). Adding a compliance contact to a project creates (if needed) a `profiles` row with `role='compliance'` and the project's `client_id`. Authentication is Supabase **magic link** — the notification email's link authenticates and deep-links to `/portal/review/[submissionId]` via the Supabase auth callback. Visiting `/portal` directly shows their queue.

## 3. Analyst submit flow (internal app)

On `app/(app)/projects/[id]/page.tsx`, a new **Compliance Review** panel:

- Shows submission history: each version with status, reviewer, note, timestamps. Latest version is the active one.
- Manages `project_recipients`: add/remove compliance contacts and AlphaRoc notify emails. Adding a compliance contact provisions portal access.
- **Submit questions for review** (modal):
  1. Upload questionnaire file → `questionnaires` Storage bucket.
  2. Server parses with Claude (see §5) → returns draft questions.
  3. **Preview step:** analyst sees extracted questions with detected types and open-text/AI-follow-up flags; can edit text, change type, toggle flags, add/remove questions.
  4. Confirm → creates `question_submission` (version = prev + 1, status `pending_review`), persists questions, emails compliance recipients.
- If the prior version was rejected, the same flow creates the next version.
- Submission status badge appears on the board card and list row.

## 4. Compliance portal

**`/portal` (home):** "Awaiting your review" (pending submissions) + "History" (decided ones). Each row: project name, version, submitted date, question count. Scoped by RLS to their client.

**`/portal/review/[submissionId]`:**

- Header: project name, version (with "resubmitted" context where version > 1), submitted date, question count, open-text count; download link to original source file.
- Filter toggle: **All questions (N)** / **Open-text only (M)** — open-text includes AI follow-ups.
- Question list in order: number, text, type badge, "AI follow-up" tag, section headings.
- Action bar: **Approve** / **Reject**, each with a confirm dialog and note field (note required on reject, optional on approve).
- One decision per submission; after deciding, the page is read-only showing the outcome.

Mockup approved in brainstorming session (header / filter / badge / action-bar layout). Built with the existing Tailwind v4 + shadcn component set, simplified client-facing layout.

## 5. Questionnaire parsing

Server-side API route, key in Vercel env vars (never client-exposed):

1. **Extract text:** `.docx` via `mammoth`; `.xlsx`/`.csv` via sheet parsing (e.g. `xlsx`); `.pdf` passed to Claude natively (document content block). Google Docs handled by exporting to .docx/PDF.
2. **Claude structured extraction:** prompt returns every question with `order_num`, `text`, `section`, `type`, `answer_options`, `is_open_text`, `is_ai_followup`. Domain rules encoded in the prompt: explicit open-end callouts ("OE", "open end", "verbatim") → open-text; **any AI-follow-up flag → open-text = true**. Use a current Sonnet-class model with JSON schema-constrained output.
3. **Validate:** schema validation + sanity checks (non-empty, plausible count); return draft to the analyst preview.

**Failure handling:** extraction/parse errors surface a clear message; analyst can retry or manually enter/edit questions in the preview editor. A bad parse never blocks submission.

## 6. Notifications (Resend)

Server-triggered transactional emails, each logged to `notification_log`:

| Trigger | Recipients | Content |
|---|---|---|
| Submission created | Project's `compliance` recipients | "AlphaRoc submitted N questions for [project]" + magic link to review page |
| Approved | Project's `alpharoc` recipients | "[Client] compliance approved questions for [project] (vN)" |
| Rejected | Project's `alpharoc` recipients | Same, including the reviewer's note |

Phase-2 emails (results ready / results approved) will reuse this pipeline.

**One-time setup (user):** Resend account + API key (`RESEND_API_KEY` env var), verified sending domain via DNS records. Test mode (send to own address) until verified.

## Error handling summary

- Parse failure → retry or manual entry fallback (§5).
- Email send failure → logged, surfaced to analyst on the submission panel ("notification failed — resend" action); submission itself still succeeds.
- Magic link expiry → standard Supabase re-request flow from the portal login page.
- Compliance user with no pending items → empty-state queue, history still visible.

## Testing

- **Unit (Vitest, existing setup):** parse-response validation, version increment logic, open-text/AI-follow-up flag rules, recipient management.
- **RLS tests:** compliance user cannot read other clients' projects/submissions/questions; cannot update non-pending submissions; analyst access unchanged. (SQL-level tests or integration tests against a local Supabase instance.)
- **Component tests:** filter toggle behavior, approve/reject dialogs, preview editor corrections.
- **Manual E2E before ship:** full loop — upload → parse → preview → submit → magic link email → portal review → reject w/ note → resubmit v2 → approve → AlphaRoc notification.

## Out of scope (phase 2+)

- Results/answers review wave (`result_submissions` parallel structure planned).
- Survey-tool API question ingestion (replaces/augments file upload as a source; `questions` table is source-agnostic).
- Per-question comments/annotations (current decision: approve/reject whole submission only).
- In-app notification center; print/PDF export of review records.
