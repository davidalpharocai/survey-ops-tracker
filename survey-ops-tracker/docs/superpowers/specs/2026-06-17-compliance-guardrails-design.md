# Compliance Guardrails — Design Spec

**Date:** 2026-06-17
**Status:** Draft for review

## Goal

Tag clients with their compliance requirements (sourced from the new **Compliance** tab in the Survey Ops sheet) and add **stage guardrails** so a survey can't proceed past the relevant point until the client's compliance requirement is met. Reuse the existing compliance-reviewer portal where possible. Keep the survey/internal separation intact (internal projects are never gated).

## Source of truth: the sheet's "Compliance" tab

Per-client columns (confirmed from the workbook):

| Column | Meaning |
|---|---|
| **Client** | Firm name (matches the `clients` table firm names — Holocene, BAM, Coatue, …) |
| **Before Fielding** (bool) | Client must review/approve **before the survey goes live** (questionnaire approval). |
| **After Fielding** (bool) | Client must review/approve **before delivery** (results/data). |
| **Not At All** (bool) | No compliance gate (both above false). |
| **Compliance Contact to Email** | Who at the client to send to (may be several, comma-separated). |
| **Comments** | Human conditions, e.g. "If contains open text". Advisory — shown to the analyst, not auto-enforced. |

Note: the **Surveys** tab also has a per-project **"Needs to Be Sent to Compliance"** column — see Open Question Q3.

## Data model

Add to `public.clients` (one migration):
- `compliance_before_fielding boolean not null default false`
- `compliance_after_fielding boolean not null default false`
- `compliance_contact text` — email(s) for the client's compliance reviewer
- `compliance_notes text` — the Comments column (advisory)

"Not At All" = both booleans false. We store the two booleans (not one flag) so they can drive the two distinct gate points. RLS already covers `clients` (analyst read/write).

Add a **`phase`** to `question_submissions` to distinguish the two reviews:
- `phase` enum/text: `before_fielding` | `after_fielding` (default `before_fielding` so existing rows are unaffected).

**"Requirement met"** reuses the existing submission + **portal review** flow (emailed link → reviewer approves/rejects → audited):
- *Before-fielding met* = an **approved** `before_fielding` submission — the existing questionnaire review, **unchanged**.
- *After-fielding met* = an **approved** `after_fielding` submission — the **same portal review**, but the reviewer also sees the **results**: the project's existing **deliverable link** (Occam study / data link, stored on the submission as `results_url`). The analyst sends this once **N Actual** is set (data cleaned).

**Recipients:** seed each project's `compliance` recipients from the client's `compliance_contact` so "send to compliance" is one click.

## Guardrails (block-with-logged-override)

- **Before-fielding client:** block advancing the project **into Fielding** (checking `stage_fielding`) until an approved review exists.
- **After-fielding client:** block marking **Delivered** (checking `stage_delivery`) until the after-fielding requirement is met.
- **Override:** a modal explains the block and offers *Override* — the analyst types a reason, which is written to the project audit log as a `(compliance override)` entry (who/when/why), or *Cancel*.
- **Banner:** the project page shows a compliance banner whenever a required review is outstanding, so the block is never a surprise at the checkbox. The banner shows the contact email and any Comments.

## Client list (Admin → Accounts)

- A **"Compliance"** badge on flagged clients (e.g. "Compliance: before+after"), plus a **filter chip** alongside Client / Former / Prospect to show just compliance clients.
- The flag (the two booleans + contact + notes) is editable on the **client page** (`/clients/[id]`); a quick toggle may also live in the Accounts row.

## Seeding & sync

- **One-time seed** from the Compliance tab: match by firm name → set the two booleans + contact + notes. (~14 clients in the tab today.)
- **Ongoing:** editable in-app **+** a `compliance-diff.mjs` script that compares the sheet's Compliance tab to the app and routes mismatches to David (app stays source of truth) — same true-up pattern already in use.

## Separation

Internal projects have no client and no compliance; they are never gated. Unchanged.

## Resolved decisions (2026-06-17)

- **D1 — Two gates, each applied only if the client has that requirement.** Before-fielding clients are blocked from entering **Fielding** until the questionnaire review is approved; after-fielding clients are blocked from **Delivery** until the results review is approved. A client with neither is never gated.
- **D2 — Flow semantics (per David):**
  - *Before fielding* = send **just the survey questions** to the client's compliance contact; approve before the survey is fielded.
  - *After fielding* = after responses are received **and cleaned** (this is what **N Actual** represents), send the **questions + answers (results)** to compliance; approve before delivery.
  - *Both* = both reviews. *Not at all* = no compliance review of any kind.
- **D3 — Build the real flow, reusing the portal** (not a manual checkbox). Both reviews run through the **existing compliance portal**: the contact gets an emailed link and approves/rejects there (real audit trail). The after-fielding review shows the questions + the project's **deliverable link** as the results artifact (no new file upload for v1).
- **D4 — Client-driven with a per-project override.** The requirement comes from the client flags, but each project has a manual toggle to force/skip compliance for edge cases (covers conditions like BAM's "if contains open text").

## Out of scope (for now)

- Auto-deriving the requirement from a client **type = Financial** — arrives with the separate *Client Entity Upgrade* spec; the manual booleans can then be back-filled from type.
- Uploading a separate results **file/crosstab** for after-fielding (v1 uses the existing deliverable link; add file upload later only if contacts need more than the link).
