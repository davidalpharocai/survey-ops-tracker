# Deliverables AI Matcher Tier — Design

**Date:** 2026-07-15
**Status:** Design approved (via brainstorming); ready for implementation-plan.
**Author:** David + Claude

## Goal

Add an AI fallback tier to the deliverables matcher so a forwarded/cc'd deliverable that the deterministic matcher can't confidently place is *intelligently* filed — cross-referencing as many signals as possible (sender, subject, attachment filename, body) plus the tracker's "memory" (surveys, client roster, contacts, and past filing history) — instead of always landing in the review queue. This is the deferred "Phase 3 AI matcher tier" from the original deliverables design.

## Where it fits

The deterministic matcher (`lib/deliverables/matcher.ts`) runs tiers in order: PR/Cl code → contact email → sender domain → name/token. It auto-files at `confidence ≥ AUTO_FILE_THRESHOLD` (0.85); everything below goes to review. The AI tier is a **new fallback that runs only for those sub-threshold cases** — confident deterministic matches never invoke it, so per-email AI cost stays near zero. Global dedup already runs *first*, so an already-filed attachment is skipped with no AI call.

## Decisions (from brainstorming)

1. **Authority = corroborated auto-file.** The AI may auto-file *only* when it is confident **and** its chosen survey is independently corroborated by a hard signal the server re-verifies. Anything softer → review, with the AI's pick pre-filled as the best guess. (Chosen over "suggest-only" and "auto-file whenever confident"; can be loosened later.)
2. **Context ("as many factors + a pass through memory") = the fullest set:** open/active surveys (name, code, client) + client roster & aliases + contacts & sender-domain map + **past deliverable→survey filing history** for the sender's client (the learning input — thin today, compounds over time).
3. **Model = `DELIVERABLES_MATCH_MODEL` env var, default `claude-haiku-4-5`.** The task is guardrailed pick-from-a-list, and the corroboration re-check makes a cheaper model's occasional miss fall to review (never a misfile), so Haiku is the cost/latency fit. Env-overridable to `claude-sonnet-5` / `claude-opus-4-8` with no code change. *(Open for David to override.)*

## Flow (in `ingestEmail`)

1. Run deterministic `matchDeliverable` (unchanged).
2. If `routeMatch(match).confident` → file as today. **No AI call.**
3. Else → **one** `aiMatch(...)` call with the email + context.
4. **Corroboration gate.** Auto-file to the AI's survey only if *both*:
   - `aiConfidence ≥ AI_AUTO_FILE_THRESHOLD` (≈ 0.9), **and**
   - `serverCorroborates(pick, email, context)` returns true — re-verified server-side, independent of the AI's own claim.
   Otherwise → review, with the AI's pick as the pre-filled best-guess candidate (shown in the reply + review queue), or "couldn't match" if the AI was unsure.
5. `serverCorroborates`: the chosen client's name (or a distinctive survey token) actually appears in the filename/subject, **OR** the sender / original-recipient domain maps to that client, **OR** a past filing exists for this client→survey. The AI must be corroborated by real evidence — its self-reported corroboration is never trusted alone.

## AI call (`lib/deliverables/ai-matcher.ts`)

- Pure, dependency-injected orchestration mirroring `lib/parsing/claude-parser.ts`: `aiMatch(input, { client = new Anthropic(), ... }) → AiMatchResult`.
- **Forced-tool structured output** via `@anthropic-ai/sdk`: a `pick_survey` tool, `tool_choice: {type:'tool', name:'pick_survey'}`, read the `tool_use` block. Model = `process.env.DELIVERABLES_MATCH_MODEL ?? 'claude-haiku-4-5'`.
- Tool input schema → `AiMatchResult`:
  - `projectCode: string | null` — chosen survey code, or null if genuinely unsure.
  - `confidence: number` — 0–1.
  - `reasoning: string` — one-line why (surfaced in the review queue).
  - `corroboratingSignal: 'filename' | 'subject' | 'sender_domain' | 'history' | null` — which hard signal the AI believes supports it (server re-verifies).
- **`projectCode` is validated against the real candidate list** we passed in; an unknown/hallucinated code is coerced to `null` → treated as unsure → review.

## Context loader

Extend `lib/deliverables/load.ts` (or a sibling `loadAiMatchContext`) to assemble, for the AI prompt:
- open/active surveys: `{project_name, project_code, client_name}` (bounded set).
- client roster + known aliases.
- contacts + domain map (already loaded for the deterministic matcher).
- **past filings:** recent `deliverable → survey` mappings grouped by client (from the `deliverables` table, `status='filed'`, non-deleted), so the model can learn a client's pattern.

No new DB migration — all inputs come from existing tables (`survey_projects`, `clients`, contacts/`project_recipients`, `deliverables`).

## Guardrails

- Runs only for internal senders past the existing gates (`isInternalSender`, attachments-only, non-duplicate). Dedup precedes the AI.
- AI output validated against the real survey list; hallucinated code → review.
- Any AI error/timeout → **fall back to review**. The tier never throws and never blocks filing. Wrap the call with a timeout.
- Never affects recipients — reply-only-to-sender and internal-only stay exactly as they are.
- One AI call per uncertain email; cheap model; the call is logged (model, decision, confidence, cost via `lib/utils/aiCost.ts` + a `system_events` row) for auditability.
- Persistence: reuse the existing deliverable row; `match_method = 'ai'` (or `'ai+corroborated'` when auto-filed), `match_confidence = aiConfidence`, and the AI pick + reasoning stored in `match_candidates` for the review UI.

## Files

- **Create** `lib/deliverables/ai-matcher.ts` + `lib/deliverables/ai-matcher.test.ts`.
- **Create/extend** the context loader in `lib/deliverables/load.ts` (+ test) to include filing history.
- **Modify** `lib/deliverables/email-ingest.ts` — call the AI tier as the sub-threshold fallback + apply the corroboration gate. New injected dep `aiMatch` (kept out of the pure module's Drive path; FakeDrive-testable).
- **Modify** `app/api/deliverables/ingest/route.ts` — wire the Anthropic client + the AI context loader.
- **No migration.**

## Testing (TDD; fake Anthropic client + `FakeDrive`)

- confident deterministic match → **no** AI call (spy asserts zero calls).
- uncertain + AI confident + corroborated → auto-files to the AI's survey.
- uncertain + AI confident but **not** corroborated → review with the AI pick as best guess.
- uncertain + AI unsure (`projectCode: null`) → review, no guess.
- AI returns an unknown/hallucinated `projectCode` → coerced to unsure → review.
- AI throws / times out → review, no crash, no thrown error.
- past-filing history steers the pick (client with a prior survey).

## Config

- `DELIVERABLES_MATCH_MODEL` (default `claude-haiku-4-5`) — set in Vercel to override the tier.
- `ANTHROPIC_API_KEY` — already in Vercel (used by the questionnaire parser).

## Out of scope (later)

- Weekly QA/dedup report (the remaining Phase-3 item).
- Loosening the authority to "auto-file whenever confident" if the corroborated tier proves reliable.
