# Deliverables Depository — Go-Live Runbook (no-admin OAuth path)

**Goal:** the in-app **"Attach deliverable"** feature live in production — analysts attach a file or link on a project page and it auto-files into the right Shared Drive folder (`Client / Project_PR#####_date`).

**Scope:** this is the in-app upload path only. Email forwarding (Apps Script + Google Group), the review queue, the "Filed ✓" reply, and the weekly QA report are **Phase 2** (not built yet).

**You'll need:** Google Cloud Console (the project where you made the service account), your Vercel project, a terminal in `survey-ops-tracker\`, ~45 min.

---

## Part 0 — Prerequisites (2 min)
- [ ] **Migration applied to production Supabase.** You ran `033_deliverables.sql` earlier and saw "Success". To double-check: Supabase → SQL Editor → run `select count(*) from public.deliverables;` → it should return `0` (not an error).
- [ ] You're a member of the Shared Drive (you're the organizer ✓).

## Part 1 — Create an OAuth client in Google Cloud (~10 min, NO admin)
1. **console.cloud.google.com** → select the **same project** you made the service account in (top-left project picker).
2. **Consent screen:** left nav → **APIs & Services → OAuth consent screen** (newer consoles call this **"Google Auth Platform"**).
   - **User type:** pick **Internal** if available (best — token never expires, no warnings). If only **External** is offered, pick **External**.
   - App name: `AlphaRoc Deliverables`; support email: your email; developer contact: your email → save through the steps.
   - **If you picked External:** on the **Test users** step → **Add users** → `david@alpharoc.ai` → save.
3. **Create the client:** left nav → **APIs & Services → Credentials → + Create credentials → OAuth client ID** (newer consoles: **Google Auth Platform → Clients → Create client**).
   - **Application type: Desktop app** ← important (enables the localhost sign-in the helper uses).
   - Name: `Deliverables CLI` → **Create**.
   - Copy the **Client ID** and **Client secret** it shows.

## Part 2 — Add the client id/secret to .env.local (2 min)
Edit `survey-ops-tracker\.env.local` and add:
```
GOOGLE_OAUTH_CLIENT_ID=<client id>.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=<client secret>
DELIVERABLES_SHARED_DRIVE_ID=0AB_Z5JdTWs9WUk9PVA
```
(Your Supabase keys are already in this file. Save.)

## Part 3 — Mint your refresh token (~3 min)
In `survey-ops-tracker\`:
```
node --env-file=.env.local scripts/get-drive-refresh-token.mjs
```
- It prints a URL → open it in a browser → **sign in as david@alpharoc.ai** → approve Drive access.
- If you see **"Google hasn't verified this app"** (External only): **Advanced → Go to AlphaRoc Deliverables (unsafe)** — normal for your own app.
- The terminal prints your refresh token. Add it to `.env.local`:
```
GOOGLE_OAUTH_REFRESH_TOKEN=<the token>
```

## Part 4 — Build the client → folder map (~5 min + review)
```
node --env-file=.env.local scripts/map-drive-folders.mjs
```
- **Success:** `Wrote scripts/drive-folder-mapping.csv (N clients)…` ← confirms the app can now read your Shared Drive.
- **Error?** Stop and send it to me.
- Open `scripts\drive-folder-mapping.csv` (columns: `client_id, folder_id, confidence, client_name, folder_name`):
  - `exact` rows → leave them.
  - `partial` / `none` rows → open that client's folder in the Shared Drive, copy its ID from the URL (after `/folders/`), paste into the `folder_id` column. Leave blank if the client has no folder yet (it'll be created on first delivery).
  - Save the CSV.
- Apply:
```
node --env-file=.env.local scripts/map-drive-folders.mjs --apply
```
→ `Applied N mappings.`

## Part 5 — Local smoke test (~5 min, recommended)
```
npm run dev
```
- http://localhost:3000 → open a real project → **Deliverables** panel → **Attach deliverable** → upload a small PDF.
- Confirm: it appears in the Shared Drive under `Client / Project_PR#####_date /`, shows in the project's Deliverables list, and a second upload of the same file says "Already filed — skipped."
- Ping me — I'll independently verify it in Drive.

## Part 6 — Vercel env vars + deploy (~10 min)
1. **Vercel → `survey-ops-tracker` → Settings → Environment Variables.** Add for **Production** (and Preview if used):
   `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`, `DELIVERABLES_SHARED_DRIVE_ID`.
2. **Deploy:** the feature is on the `feat/deliverables` branch. Tell Claude **"open the PR"** → it pushes the branch, opens a PR against `main`, and resolves any conflicts with the other session's work. **Merging the PR auto-deploys to production.**

## Part 7 — Verify in production
- After the deploy, attach a deliverable on a project in the live app; confirm it lands in Drive. Claude will re-check Drive + DB.

## Important — the OAuth token & next week
- **External** consent screen → the refresh token expires in **~7 days**. Fine for now; switch to the **service account** route next week when your admin is back (they do one Domain-Wide-Delegation grant; you swap env vars — no code change). **Internal** → no expiry, switch whenever.
- The code already supports both modes; the switch is env-vars only.
