# Deliverables email capture — transport setup (free, no admin)

Lets the team **bcc / cc / forward** an outbound client email to **deliverables@alpharoc.ai**;
the app auto-files the attachments/links into the client's Shared Drive folder (or the in-app
review queue) and replies "Filed ✓".

## What you set up (one time)

1. **Create the Google Group `deliverables@alpharoc.ai`** (groups.google.com -> Create group).
   - Allowing external posting is harmless because the app only processes messages **from @alpharoc.ai**.
   - Set the group to **deliver messages to a backing inbox**: add a Workspace user (e.g. an ops
     mailbox you control) as a member with "Each email" delivery. The simplest reliable option:
     add one Workspace user as a member so every group message also lands in that user's Gmail inbox.

2. **In that backing inbox's Google account**, go to **script.google.com -> New project**.
   - Paste the contents of `deliverables-forwarder.gs`.
   - **Project Settings -> Script properties -> Add**:
     - `INGEST_URL` = `https://survey-ops-tracker.vercel.app/api/deliverables/ingest`
     - `WEBHOOK_SECRET` = (the same value already set in Vercel — ask the app owner)
   - Run **`installTrigger`** once. Approve the OAuth consent (Gmail read + external requests).
     This authorizes the script to read that inbox and call the app.

3. **Done.** Within ~5 minutes of a message landing, it's processed and the thread gets a
   `deliverables-filed` label. The sender receives a "Filed ✓ / Needs a quick review" reply.

## Tips for the team
- Put the project code (e.g. **PR00003**) in the subject for a near-certain auto-file.
- Attachments and Google/Occam/Edwin links are both captured.
- Anything we can't confidently match appears in the app's **Deliverables -> Review queue**.

## Notes
- The script is intentionally dumb; all matching/filing logic is in the app. Retries are safe
  (the server de-dupes by Gmail message id).
- Attachments over ~25 MB are skipped by the script — share those as a Drive link instead.
