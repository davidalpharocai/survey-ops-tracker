# Email → Activity Timeline — Go-Live Runbook

**What this turns on:** client emails automatically appear in each project's
**Activity** timeline. Confident matches (a project code, a survey ID, or a known
contact whose email names the project) log automatically; anything uncertain lands
in the **Email Review** queue for one-click filing. Nothing confidential is exposed —
only mail from a known client contact/domain ever leaves a captain's inbox, and it's
forwarded (a copy), never moved.

**Design:** captains' Gmail filters forward client-tied mail → a free Google Group
`activity@alpharoc.ai` → one backing-inbox Apps Script → the app. See
`docs/superpowers/specs/2026-07-07-email-to-activity-design.md`.

**Time:** ~30 min for the shared setup + ~3 min per captain.

---

## Part 0 — Prerequisites
- [ ] You can create a Google Group and edit its settings (groups.google.com).
- [ ] You know the app's `WEBHOOK_SECRET` (already set in Vercel — it's the same one the deliverables forwarder uses).
- [ ] (Check) Google Workspace admin allows auto-forwarding to an internal address. Internal forwarding to `activity@alpharoc.ai` is normally allowed; if your admin blocks all auto-forwarding, that must be relaxed for this to work.

## Part 1 — Create the `activity@` Group + backing inbox (~10 min)
1. **groups.google.com → Create group** → `activity@alpharoc.ai`. (This is a **Group**, not a paid mailbox.) This is **separate** from `deliverables@`.
2. Group settings → **Who can post → "Anyone in the organization."** External senders are ignored by the app, so external posting can normally stay off — **but** Gmail's forwarding-verification codes arrive from an external Google address, so during Part 4 you'll briefly allow external posting (or allowlist `forwarding-noreply@google.com`), then re-tighten.
3. Give it a **backing inbox**: add a Workspace user as a member with **"Each email"** delivery, so every group message also lands in that user's Gmail.
4. In that backing inbox, **create a Gmail filter** so the script only ever sees activity mail: Gmail → Settings → **Filters and Blocked Addresses → Create a new filter** → **Has the words** = `list:activity@alpharoc.ai` → **Create filter** → check **Apply the label → `Activity`** and **Skip the Inbox (Archive it)**.

## Part 2 — Install the forwarder script (~5 min)
1. In the backing inbox's Google account: **script.google.com → New project**.
2. Paste the contents of `scripts/apps-script/activity-forwarder.gs`.
3. **Project Settings → Script properties → Add:**
   - `INGEST_URL` = `https://survey-ops-tracker.vercel.app/api/webhooks/email-activity`
   - `WEBHOOK_SECRET` = (the same value set in Vercel)
4. Run **`installTrigger`** once → approve the OAuth consent (Gmail read + external requests).

## Part 3 — Apply migration 048 (~2 min)
1. Supabase → **SQL Editor** → paste and run `supabase/migrations/048_email_activity.sql`.
2. Quick check: `select count(*) from public.email_inbox;` returns `0` (not an error), and `select delivered_at from public.survey_projects limit 1;` doesn't error.

## Part 4 — Each captain sets up capture (~3 min each)
1. **Verify the forwarding address** (required — Gmail silently drops forwards to unverified addresses). In each captain's Gmail → Settings → **Forwarding and POP/IMAP → Add a forwarding address** → `activity@alpharoc.ai` → **Next → Proceed**. Gmail then emails a confirmation code **from `forwarding-noreply@google.com` to `activity@`** — which lands in the **backing inbox**, not the captain's own inbox. So:
   - a. One-time, in the Group settings, **temporarily allow posting from outside the organization** (or allowlist `forwarding-noreply@google.com`) so that code email is accepted.
   - b. The **backing-inbox owner** opens each verification email (under the `Activity` label / archived), then either **clicks the verification link** in it or copies the code to the captain to paste into their "Add a forwarding address" dialog.
   - c. After every captain is verified, **re-tighten** the Group to organization-only posting.
   (You do **not** need to turn on "forward all mail" — the imported filters do the forwarding.)
2. **Download the filter set:** signed in to the app as an analyst, open
   `https://survey-ops-tracker.vercel.app/api/admin/gmail-filters` → it downloads `survey-ops-activity-filters.xml`.
3. **Import it:** Gmail → Settings → **Filters and Blocked Addresses → Import filters** → choose the file → **Open file → Create filters**. (These forward client mail to `activity@` and leave your own copy untouched.)
   - **Re-importing later** (after clients/contacts change and you regenerate): Gmail import does **not** de-duplicate — first delete the old "Survey Ops activity capture" filters, then import the fresh set.

## Part 5 — Transport spike (verify before trusting it) (~5 min)
This confirms the two assumptions the dedup + inbound matching rely on.
1. From **two** captain accounts that have imported the filters, have a client contact (or a test address matching a contact/domain) send **one** email that reaches both.
2. Within ~5 min, confirm in the app that it appears **once** (not twice) — either auto-logged on the project's Activity or a single row in **Email Review**. (One row = the RFC-822 Message-ID dedup worked across mailboxes.)
3. Confirm the entry shows the **original external sender** (inbound), not a captain's address. If it shows a captain as the sender, the Group is rewriting `From` (DMARC) — disable "From" munging in the Group's settings and re-test.

## Part 6 — Verify live
- A real inbound client email tied to an active project should appear in that project's **Activity** within ~5 min (confident match) or in **Email Review** (uncertain). File one from the queue and confirm it moves onto the timeline.

---

## How matching decides (reference)
- **Auto-logs** (no review): an email containing a **PR-code** or a **validated survey ID**; or from a **known contact** where the project is pinned (its name appears in the email, or the client has exactly one active project).
- **Review queue**: a known client but 2+ possible projects and nothing names one; a shared-domain contact (gmail.com etc.); a contact mapping to multiple clients; anything without a confident project.
- **Delivered + 2 days:** emails still auto-log to a project for 2 days after it's marked delivered (catches stragglers), then fall to review.
- **Nothing confidential leaves the inbox:** only mail matching the client contact/domain filters is forwarded; everything else stays put.
