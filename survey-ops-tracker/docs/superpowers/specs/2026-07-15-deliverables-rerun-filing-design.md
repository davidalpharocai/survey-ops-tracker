# Deliverables: rerun-aware filing + client-first matching — Design

**Date:** 2026-07-15
**Status:** Approved (design), implementing

## Goal

Fix two related filing failures surfaced by a real forward, `holocene_ai_tracker_survey_0715.xlsx`:

1. **Wrong-client match.** The matcher picked **Bain → "AI tracker" (PR00039)** over **Holocene**, even though `holocene` is right in the filename — so it landed in review instead of filing.
2. **Rerun folder fragmentation.** The Holocene AI tracker is a *weekly rerun*; the current scheme would create a new dated folder every wave.

## Context

- Reruns are recurring longitudinal surveys. The Holocene Tracker is weekly. Outside Holocene, reruns usually arrive **monthly/quarterly from Sree**.
- **Only PR00149 (Holocene Tracker) is in scope to flag as a rerun now.** More will be flagged as they arrive; auto-detection is out of scope.

## Problem 1 — a cross-client name match outranks the client named in the file

`matchDeliverable` tier-4 assigns **0.75** when a project's full name appears verbatim in the signals. `"ai tracker"` (Bain, PR00039) appears verbatim inside `"holocene ai tracker survey"`, scoring 0.75 — above Holocene Tracker's 0.62 (one distinctive token; `tracker` is a stopword, `ai` too short). The AI tier then also picked Bain. Net: wrong-client best guess, sub-0.9 → review.

### Fix A — client-first gating (`lib/deliverables/matcher.ts`)

When at least one client's distinctive name is present in the focused signals (subject + filename), demote name-tier candidates whose client is **not** among the named clients:

- Compute `namedClientIds` = client ids whose normalized name (len ≥ 3, not `SELF_ORG`) is a whole-token match in `focused` (the same test the existing client-name tier uses).
- When pushing a tier-4 project-name candidate (verbatim `pname` **or** `ptoken`), if `namedClientIds` is non-empty **and** `p.client_id ∉ namedClientIds`, cap its confidence at `CROSS_CLIENT_CAP = 0.35`.
- Explicit tiers (code / contact / domain) are untouched. If no client is named (e.g. "Korea Consumer Survey"), behavior is unchanged.

Result: a `holocene_…` file can never rank Bain highest; Holocene's projects rise to the top.

### Fix B — AI prompt + corroboration hardening (`lib/deliverables/ai-matcher.ts`)

- **Prompt:** add an explicit client-first rule to `AI_MATCHER_SYSTEM` — *if the filename or subject clearly names a client, the deliverable belongs to that client; never pick a different client's project because its project name matches other words.*
- **`serverCorroborates`:** the distinctive-project-token path must exclude generic jargon. Share `NAME_STOPWORDS` from `matcher.ts` (export it) so a token like `tracker` no longer corroborates a pick. Client-name / domain / history corroboration unchanged.

## Problem 2 — reruns fragment into a new dated folder every wave

`projectFolderName(name, code, deliveredISO)` → `{name}_{code}_{YYYY.MM.DD}`. A weekly rerun makes a new folder each wave.

### Fix C — rerun folder = undated parent (`naming.ts` + ingest + resolve)

- `projectFolderName(name, code, deliveredISO, isRerun = false)`: when `isRerun`, return `{name}_{code}` (no date suffix). One-shot projects unchanged. `deliverableFileName` is unchanged — files stay `{YYYY.MM.DD} — name`, so waves stack inside the one parent folder.
- **Detection:** `survey_projects.longitudinal === true`.
- **Threading:**
  - `ProjectRec` (types.ts) gains `longitudinal: boolean`.
  - `loadMatchData` selects `longitudinal`.
  - `email-ingest.ts` passes `isRerun` (from the matched project's `longitudinal`) into the `FolderResolver.projectFolderName`.
  - The resolve route's `getProject` selects `longitudinal` and passes it through the same resolver.

## Data step

- Set `longitudinal = true` on **PR00149** (Holocene Tracker) after deploy.
- Future reruns are flagged as they arrive. Recommendation for later (not this change): a longitudinal toggle on the project page and/or a sheet-sync mapping from the rerun radar; Sree's sender + monthly/quarterly cadence is a usable future signal.

## Testing (TDD)

- **matcher.test.ts:** "holocene ai tracker survey" with Bain "AI tracker" + Holocene "Holocene Tracker" candidates → best is Holocene, the Bain candidate is capped ≤ 0.35. Regression: a no-client-named case (Korea) is unchanged.
- **ai-matcher.test.ts:** `serverCorroborates` returns false when the only support is a jargon token (`tracker`); still true on the client name / a distinctive token.
- **naming.test.ts:** `projectFolderName(..., isRerun=true)` has no date; default still dated.
- **email-ingest.test.ts:** a match to a longitudinal project files into the undated parent folder (`{name}_{code}`), file still dated inside.

## Rollout

Build test-first → `vitest` + `build` + `lint` → PR → merge → deploy → set `PR00149.longitudinal = true` → re-ingest the Holocene file → confirm it auto-files to
`Holocene / Holocene Tracker_PR00149 / 2026.07.15 — holocene_ai_tracker_survey_0715.xlsx`, and that future waves stack in that folder.
