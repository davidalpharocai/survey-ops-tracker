# Calendar Tab (Design)

**Date:** 2026-07-16
**Status:** Approved (design), pending spec review → plan → build
**Scope:** A read/navigate calendar view of everything dated in the tracker. Separate from the in-app assistant spec.

## Goal

One place to see **what's due** — project deadlines and other dated events on a month grid, filterable by owner, type, and more, so the team (and Sree for reruns) can spot crunch weeks at a glance.

## Events shown (color-coded by type, legend doubles as on/off toggles)

Derived from data the app already has — **no new tables or migration**:

| Type | Source field | Notes |
|---|---|---|
| **Due** (internal) | `survey_projects.due_date` | keeps overdue/soon urgency tint |
| **Deliver** (client) | `survey_projects.deliver_date` | keeps urgency tint |
| **Launch** | `survey_projects.launch_date` | field go-live |
| **Rerun** (next wave) | `survey_projects.rerun_date` (longitudinal only) | for Sree |
| **Reminder** | `reminders.due_date` (caller's own) | personal |

Each project contributes up to four events (its dates); reminders are the caller's own.

## Filters (persist per user in `localStorage`)

- **Event-type** toggles (the legend).
- **Captain / owner** (dropdown).
- **Project type** — PS / B2B / Rerun (lets Sree isolate reruns).
- **Just mine** — one-click to the caller's own captained projects.
- **Status scope** — **default: Open projects only** (status = `Open` AND phase = `Active`; excludes Closed, On-Hold, and pre-sale Scoping). Opt-in switches to **include On-Hold**, **include Closed**, **include Scoping**.
- **Client** — focus one client's deadlines.
- **Priority** — high/urgent only.

Reminders are unaffected by project-status/type/captain filters (they're personal), but obey their own legend toggle.

## Layout

- **Month grid**, navigable: ‹ / › to change month, **Today** button, current month + year header. Weeks start Sunday (match the app's date conventions).
- Each **day cell**: today highlighted; lists its events as compact colored chips (icon/dot + short label like "Deliver · Acme Q3"). Overflow → show first ~3 + **"＋N more"**; clicking the day opens a popover/list of all that day's events.
- **Click an event** → navigate to that project's page (a reminder opens its linked project, or is a no-op if unlinked).
- **Mobile / narrow**: fall back to an **agenda list** (chronological, grouped by day, today first) — the grid doesn't shrink well on phones.

## Components / files

- `app/(app)/calendar/page.tsx` — the route; owns filter state (+ localStorage persistence).
- `components/calendar/CalendarGrid.tsx` — month grid rendering + day overflow/popover.
- `components/calendar/CalendarAgenda.tsx` — the mobile/narrow agenda fallback.
- `components/calendar/CalendarFilters.tsx` — legend + filter controls.
- `lib/hooks/useCalendarEvents.ts` — reuses `useProjects` (already cached via React Query) to derive events client-side, fetches the caller's reminders, applies filters, returns events keyed by date. Dataset is dozens–low-hundreds of projects, so client-side derivation from one fetch is fine.
- Nav: add a **Calendar** entry to the app shell nav.

## Data flow

1. `useProjects()` (existing) + a reminders query (caller's own, `user_id = session.user.id`, not done).
2. `useCalendarEvents` maps each in-scope project → its dated events, adds reminders, applies the active filters, buckets by `YYYY-MM-DD`.
3. `CalendarGrid` renders the visible month from those buckets.

## Error handling

- Reminders table missing / query fails → skip reminders (empty), never break the calendar (same degrade-gracefully pattern as elsewhere).
- Projects load error → the page's existing error/empty state.

## Testing

- `useCalendarEvents` unit tests: a project with all four dates yields four correctly-typed events; status-scope default excludes Closed/Hold/Scoping; type/captain/mine/client/priority filters narrow correctly; a longitudinal project contributes a Rerun event only when `rerun_date` is set.
- Overflow: a day with >3 events shows "＋N more".
- Manual: month nav, Today, click-through to a project, legend toggles, mobile agenda fallback.

## Out of scope

Creating/editing events or dates from the calendar (read/navigate only — change dates via the assistant or the project page); iCal / Google Calendar sync; week/day views (month + agenda only for v1).
