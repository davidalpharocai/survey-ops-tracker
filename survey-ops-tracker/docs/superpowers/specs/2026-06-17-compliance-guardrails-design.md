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

**"Requirement met"** reuses the existing compliance submissions/reviewer flow:
- *Before-fielding met* = the project has an **approved** compliance submission (the portal already does pre-fielding questionnaire review). ✅ existing mechanism.
- *After-fielding met* = see **Q2** (questionnaire approval vs a separate results sign-off).

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

## Open questions (resolve at review)

- **Q1 — Two gates or one?** Gate at **both** Fielding (before-fielding clients) **and** Delivery (after-fielding clients), matching the sheet's intent? *(Recommended: yes, both. The sheet clearly distinguishes them.)* Alternative: a single Delivery gate for any compliance client (simpler, but ignores the before-fielding intent and lets a non-approved survey field).
- **Q2 — What does "After Fielding" review?** The existing portal reviews the **questionnaire**. "After fielding" implies reviewing **results/data** before delivery, which the portal doesn't model. *(Recommended: for v1, after-fielding is satisfied by a manual **"compliance sign-off"** checkbox on the project — fast to build, auditable — and we revisit a full results-review portal flow later.)*
- **Q3 — Per-project override?** The Surveys tab has a per-project "Needs to Be Sent to Compliance" column. *(Recommended: drive the requirement from the client, but allow a per-project manual toggle to force/skip compliance in edge cases — covers the BAM-style "if contains open text" condition.)*

## Out of scope (for now)

- Auto-deriving the requirement from a client **type = Financial** — that arrives with the separate *Client Entity Upgrade* spec; at that point the manual booleans can be back-filled from type.
- A full client-facing **results-review** portal (Q2 fallback is a checkbox).
