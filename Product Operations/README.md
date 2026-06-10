# Product Operations

Workspace folder for AlphaRoc product-operations projects.

## Projects

| Project | Where it lives | Status |
|---|---|---|
| Survey Ops Project Tracker | [`../survey-ops-tracker/`](../survey-ops-tracker/) | Live on Vercel |
| Client Compliance Portal | Inside the tracker app (`/portal` routes) — branch `compliance-portal-wt` | Code complete; awaiting DB migrations + E2E |

The compliance portal is intentionally part of the survey-ops-tracker codebase: it shares the
same Supabase database, auth, and deployment. It is listed here as its own product line.
New standalone product-ops tools should get their own subfolder here.

Design docs for the portal: `../docs/superpowers/specs/2026-06-10-compliance-portal-design.md`
