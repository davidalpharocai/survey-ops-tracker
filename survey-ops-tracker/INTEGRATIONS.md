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

## Make.com scenario: Survey IDs from Google Sheets (scheduled)

1. **Trigger**: Schedule (e.g. every 30 minutes)
2. **HTTP module**: GET `/api/webhooks/sync` with the secret header → list of projects
3. **Iterator**: loop over `projects`
4. **Filter**: keep projects whose `linked_documents` contains a `docs.google.com/spreadsheets` URL
5. **Google Sheets module**: "Get range values" — parse the spreadsheet ID out of the URL; read the cell/column where survey IDs live (agree on a convention, e.g. a tab named `Meta`, cell `B2`, comma separated)
6. **HTTP module**: POST `/api/webhooks/sync` with `project_id` + `survey_ids_from_sheet`

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
