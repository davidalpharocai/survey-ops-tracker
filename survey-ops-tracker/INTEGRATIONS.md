# External Integrations

How external workflows (Make.com) talk to the tracker. All endpoints authenticate with the shared secret — send it as a header on every request:

```
x-webhook-secret: <WEBHOOK_SECRET from .env.local / Vercel env vars>
```

Base URL: `https://survey-ops-tracker.vercel.app`

---

## Sync API

### GET /api/webhooks/sync

Returns every **Open** project with the fields a sync workflow needs:

```json
{
  "projects": [
    {
      "id": "uuid",
      "project_name": "Payments Infra Decision Makers",
      "status": "Open",
      "phase": "Active",
      "linked_documents": ["https://docs.google.com/spreadsheets/d/..."],
      "survey_tool_id": "SV-2201, SV-2202",
      "survey_ids_from_sheet": "SV-2201, SV-2202",
      "n_collected": 142,
      "n_target": 250
    }
  ]
}
```

### POST /api/webhooks/sync

Updates one project. Body:

```json
{
  "project_id": "uuid",
  "survey_ids_from_sheet": "SV-2201, SV-2202",   // optional
  "n_collected": 187                              // optional
}
```

**Survey IDs rule** (handled server-side — the workflow just reports what the sheet says):
- Field blank in the tracker → filled from the sheet
- Sheet value changed since last sync → sheet wins (overwrites manual edits)
- Sheet unchanged → manual edits in the tracker are preserved

`n_collected` also stamps `n_last_synced`.

---

## Make.com scenario: Survey IDs from the master Survey Ops sheet (scheduled)

**Source of truth**: the "Surveys" tab of the master Survey Ops sheet
(`https://docs.google.com/spreadsheets/d/1ZTTJ0PQZ7vj13tmZmsMvKAcEEf0Nc0s8dVbfaYJju7Q`).
Its "Survey IDs" column is auto-filled daily at **6:15pm** by an existing process, so schedule
this scenario shortly after (e.g. 6:30pm), plus optionally once mid-morning.

Survey ID format: `[owner initials][client+project abbreviation][YYYYMMDD created][region]`
e.g. `ALBNFOF20260529UK` = Alden + Bain Future of Food + 2026-05-29 + UK.

1. **Trigger**: Schedule — daily 6:30pm (after the 6:15pm auto-fill)
2. **HTTP module**: GET `/api/webhooks/sync` with the secret header → tracker projects
3. **Google Sheets module**: "Search rows" on the Surveys tab — rows with Status = "In Progress" or blank
   (note: the sheet is large; Make's Google Sheets module paginates properly, but plain
   connector-style reads truncate around row 74 — don't use those)
4. **Matching**: match sheet rows to tracker projects on Client (col B) + Project Name (col C)
5. For each match, take the row's "Survey IDs" column. If empty, fall back to the row's
   "GoogleSheet" column link (the IDs live in that linked SHEET, never the questionnaire Doc);
   the "Edwin Link" `source=` URL parameter is a cross-check — it is also a survey ID.
6. **HTTP module**: POST `/api/webhooks/sync` with `project_id` + `survey_ids_from_sheet`

The tracker applies the blank-or-sheet-changed rule server-side (manual edits survive unless the sheet changes).

## Make.com scenario: N Collected from the survey tool (scheduled)

1. **Trigger**: Schedule (e.g. every 15 minutes)
2. GET `/api/webhooks/sync` → projects with non-empty `survey_tool_id`
3. For each survey ID, query the internal survey tool for its response count; sum per project
4. POST `/api/webhooks/sync` with `project_id` + `n_collected`

---

## Testing the API by hand

```bash
# List projects
curl -H "x-webhook-secret: $WEBHOOK_SECRET" https://survey-ops-tracker.vercel.app/api/webhooks/sync

# Update one
curl -X POST -H "x-webhook-secret: $WEBHOOK_SECRET" -H "Content-Type: application/json" \
  -d '{"project_id":"<uuid>","n_collected":187}' \
  https://survey-ops-tracker.vercel.app/api/webhooks/sync
```
