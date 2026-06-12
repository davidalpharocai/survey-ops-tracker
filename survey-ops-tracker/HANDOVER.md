# Survey Ops — Systems & Handover ("Lottery Doc")

*Last updated: June 11, 2026. Purpose: if David is suddenly unavailable (lottery, desert island), this doc lets the team keep the tracker running without him.*

> **Credentials never live in this file.** The filled-in copy (passwords added by David) lives in Google Drive: [Systems & Handover doc](https://docs.google.com/document/d/1rkT0KYApcvYU1BlK-TO_lfiXyhL0FuGIPz9UjduSJgk/edit). This repo copy is the maintained source of truth for everything *except* the blanks.

## 1. What the system is

The Survey Ops Command Center (https://survey-ops-tracker.vercel.app) is a web app that replaced the "Survey Ops" Google Sheet. The code lives on GitHub; Vercel hosts the website and automatically publishes any change pushed to `main`; Supabase stores all the data (projects, steps, bids, logs) and handles logins; the Anthropic API powers the AI assistant and AI data entry.

Flow: **GitHub (code) → Vercel (website) → Supabase (data + logins) → your browser.** The AI features call Anthropic. The morning digest posts to Slack.

## 2. The accounts

| System | What it does | Where |
|---|---|---|
| Vercel | Hosts the site, holds secret keys, runs scheduled jobs | team `alpha-roc`, project `survey-ops-tracker` |
| GitHub | Stores the code | https://github.com/davidalpharocai/survey-ops-tracker |
| Supabase | Database + team logins (Authentication → Users) | project ref `xcfoyxyxovibltwfydbf` |
| Anthropic | AI key + credits (check credits first if AI breaks) | https://console.anthropic.com |
| Slack | Incoming webhook posts the 8am ET digest to #survey-ops | https://api.slack.com/apps |
| Google Drive | User Guide + the filled-in copy of this doc | owner david@alpharoc.ai |

Account owners, login emails, and passwords: **in the Drive copy only.**

## 3. Secret keys (environment variables)

All live in Vercel → Settings → Environment Variables. Never in the code or this file.

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — connects the site to the database (public by design)
- `SUPABASE_SERVICE_ROLE_KEY` — full database access; treat like a master key
- `ANTHROPIC_API_KEY` — the AI key
- `CRON_SECRET` — protects the two scheduled jobs
- `WEBHOOK_SECRET` — protects the data-sync webhooks (Make.com etc.)
- `SLACK_WEBHOOK_URL` — where the digest posts

If a key leaks: generate a new one in the source system, paste it over the old value in Vercel, then redeploy (Deployments → ⋯ → Redeploy).

## 4. Things that run on a schedule

- **Survey ID sync** — daily 22:45 UTC (~6:45pm ET): reads each project's Edwin link and fills in / checks survey IDs; mismatches show an amber banner on the project
- **Morning digest** — daily 12:00 UTC (8am ET): posts overdue / due-soon / behind-pace projects to Slack

Both are configured in `vercel.json` and visible under Vercel → Settings → Crons.

## 5. Runbooks

**Site is down / broken after a change** — Vercel → Deployments. If the newest deployment says Error, "⋯" on the last working one → Promote to Production. Site restored; fix the code later.

**Someone can't log in** — Supabase → Authentication → Users → find them → Send password recovery (or set a password directly). New teammate: Add user with an @alpharoc.ai email — anything else is blocked everywhere by design.

**AI assistant / AI form unavailable** — 1) console.anthropic.com → check credits (this exact thing happened once). 2) Check `ANTHROPIC_API_KEY` in Vercel.

**Digest stopped posting** — 1) `SLACK_WEBHOOK_URL` exists in Vercel? 2) Slack admin: webhook/app still installed? 3) Vercel → Logs → `/api/cron/daily-digest`.

**Survey IDs look wrong** — open the project → Links & setup; the amber banner offers "Use Edwin ID" or "Keep current". The nightly sync only fills blanks and flags conflicts — it never silently overwrites.

**Data looks wrong / something deleted** — check the project's Data Change Log tab and Activity; closed projects are reopenable (Full View → Closed); true restores via Supabase daily backups (Database → Backups).

**Need to change the code without David** — the repo is plain Next.js. Any developer (or Claude in Claude Code, pointed at this repo) can work on it: push to `main` and Vercel ships it automatically. Two Vercel settings must never change: Root Directory = `survey-ops-tracker`, Framework = Next.js.

## 6. Who has access today

App users (Supabase Auth): the ops team, @alpharoc.ai emails only. Dashboards (Vercel/GitHub/Supabase/Anthropic): David only.

**Single biggest risk:** David is the only dashboard owner everywhere. Recommended fix: add one more trusted person as co-owner/admin on all four systems, with passwords in the company password manager.

---

*Maintained by Claude alongside the app. Passwords only ever live in the Drive copy, added by David.*
