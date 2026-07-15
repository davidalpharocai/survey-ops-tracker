# Campaign Manager Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Campaign Manager URL field to the project's Links & Setup tab that stores the link and live-fetches the N completed count from the Campaign Manager analytics API.

**Architecture:** Store `campaign_manager_url` on `survey_projects`. A new server-side Next.js API route (`/api/campaign-analytics`) proxies the fetch to the Campaign Manager's analytics endpoint (avoiding CORS entirely). The `CampaignManagerLink` component calls this route on mount and shows the completion count alongside the link; if the fetch fails it degrades gracefully with a "—" badge.

**Tech Stack:** Next.js 15 App Router, React Query (`useUpdateProject`), Supabase (migration), TypeScript

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `supabase/migrations/038_campaign_manager_link.sql` | Adds `campaign_manager_url TEXT` column |
| Modify | `lib/hooks/useProjects.ts` | Add field to `SurveyProject` type + `SLIM_PROJECT_COLUMNS` exclusion comment |
| Create | `app/api/campaign-analytics/route.ts` | Server-side proxy: parse URL → fetch Campaign Manager analytics → return `{ completed }` |
| Create | `components/project/CampaignManagerLink.tsx` | URL input + live N-completed badge |
| Modify | `app/(app)/projects/[id]/page.tsx` | Import + render `CampaignManagerLink` in Links & Setup tab |

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/038_campaign_manager_link.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/038_campaign_manager_link.sql
ALTER TABLE survey_projects
  ADD COLUMN IF NOT EXISTS campaign_manager_url TEXT;
```

- [ ] **Step 2: Run the migration in Supabase**

Open the Supabase dashboard → SQL editor, paste and run the migration. Confirm the column appears on `survey_projects`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/038_campaign_manager_link.sql
git commit -m "feat(db): add campaign_manager_url to survey_projects"
```

---

## Task 2: Update the TypeScript type

**Files:**
- Modify: `lib/hooks/useProjects.ts`

The `SurveyProject` type is derived from Supabase's generated types. After running the migration, regenerate or manually add the field.

- [ ] **Step 1: Add the field to `SurveyProject`**

Find the `SurveyProject` type definition (or the Supabase `Tables<'survey_projects'>['Row']` usage) in `lib/hooks/useProjects.ts`. If it's a manual interface, add:

```ts
campaign_manager_url: string | null
```

If it's derived from `lib/supabase/types.ts` (generated), regenerate with:
```bash
cd survey-ops-tracker
npx supabase gen types typescript --project-id <your-project-id> > lib/supabase/types.ts
```

(If regeneration isn't practical right now, just add the field manually to the `Row` type in `lib/supabase/types.ts` under the `survey_projects` table.)

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd survey-ops-tracker
npx tsc --noEmit
```

Expected: no new errors related to `campaign_manager_url`.

- [ ] **Step 3: Commit**

```bash
git add lib/hooks/useProjects.ts lib/supabase/types.ts
git commit -m "feat(types): add campaign_manager_url to SurveyProject"
```

---

## Task 3: Server-side analytics proxy route

**Files:**
- Create: `app/api/campaign-analytics/route.ts`

This route accepts `?url=<campaign-manager-url>`, parses the campaign ID, fetches the Campaign Manager analytics endpoint server-side (no CORS), and returns `{ completed: number }`. If the fetch fails it returns `{ completed: null, error: string }`.

- [ ] **Step 1: Write the route**

```ts
// app/api/campaign-analytics/route.ts
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get('url')
  if (!rawUrl) {
    return NextResponse.json({ error: 'url param required' }, { status: 400 })
  }

  // Accept both /campaigns/35 and /campaigns/35/... paths
  const match = rawUrl.match(/\/campaigns\/(\d+)/)
  if (!match) {
    return NextResponse.json({ error: 'could not parse campaign ID from URL' }, { status: 400 })
  }
  const campaignId = match[1]

  const analyticsUrl =
    `https://main.d3plqclbjc4ah9.amplifyapp.com/api/proxy/campaigns/${campaignId}/analytics`

  try {
    const res = await fetch(analyticsUrl, { next: { revalidate: 60 } })
    if (!res.ok) {
      return NextResponse.json(
        { completed: null, error: `Campaign Manager returned ${res.status}` },
        { status: 200 },
      )
    }
    const data = await res.json()
    const completed: number | null = data?.response_summary?.completed ?? null
    return NextResponse.json({ completed })
  } catch (err) {
    return NextResponse.json(
      { completed: null, error: 'fetch failed' },
      { status: 200 },
    )
  }
}
```

- [ ] **Step 2: Smoke-test the route manually**

Start the dev server (`npm run dev` in `survey-ops-tracker/`) and open:

```
http://localhost:3000/api/campaign-analytics?url=https://main.d3plqclbjc4ah9.amplifyapp.com/campaigns/35
```

Expected: `{ "completed": 36 }` (or `{ "completed": null, "error": "..." }` if the Campaign Manager API requires auth — see note below).

> **Auth note:** If the Campaign Manager API requires authentication the response will be `{ completed: null, error: "Campaign Manager returned 401" }`. In that case the component will degrade gracefully (show "—"). The fix would be to add an API key to the Campaign Manager and pass it as a header here; coordinate with whoever owns that app.

- [ ] **Step 3: Commit**

```bash
git add app/api/campaign-analytics/route.ts
git commit -m "feat(api): campaign-analytics proxy route"
```

---

## Task 4: CampaignManagerLink component

**Files:**
- Create: `components/project/CampaignManagerLink.tsx`

Follows the same card + editable-URL pattern as `SlackChannel.tsx`. Fetches N completed from our proxy route on mount (and whenever the URL changes).

- [ ] **Step 1: Write the component**

```tsx
// components/project/CampaignManagerLink.tsx
'use client'
import { useEffect, useState } from 'react'
import { useUpdateProject } from '@/lib/hooks/useProjects'
import { InfoTooltip } from '@/components/shared/InfoTooltip'

interface Props {
  projectId: string
  url: string | null
}

export function CampaignManagerLink({ projectId, url }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [completed, setCompleted] = useState<number | null>(null)
  const [fetchError, setFetchError] = useState(false)
  const updateProject = useUpdateProject()

  useEffect(() => {
    if (!url) return
    setCompleted(null)
    setFetchError(false)
    fetch(`/api/campaign-analytics?url=${encodeURIComponent(url)}`)
      .then(r => r.json())
      .then(data => {
        if (data.completed != null) {
          setCompleted(data.completed)
        } else {
          setFetchError(true)
        }
      })
      .catch(() => setFetchError(true))
  }, [url])

  function handleSave() {
    const trimmed = draft.trim()
    updateProject.mutate({
      id: projectId,
      updates: { campaign_manager_url: trimmed || null },
    })
    setDraft('')
    setEditing(false)
  }

  const showInput = editing || !url

  return (
    <div className="bg-card border border-border shadow-sm rounded-xl p-4">
      <h3 className="text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium flex items-center">
        Campaign Manager
        <InfoTooltip text="Link to this project's Campaign Manager entry. N Completed is fetched live from the campaign analytics." />
      </h3>

      {url && !editing && (
        <div className="flex items-center gap-2 mb-2">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-1 items-center gap-2 bg-muted rounded-lg px-3 py-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-accent transition-colors"
          >
            <span>📊</span>
            <span className="truncate">Open campaign</span>
          </a>
          {/* N completed badge */}
          <span
            className={`text-xs px-2 py-1 rounded-lg font-medium tabular-nums ${
              completed != null
                ? 'bg-green-500/15 text-green-700 dark:text-green-400'
                : fetchError
                ? 'bg-muted text-muted-foreground'
                : 'bg-muted text-muted-foreground animate-pulse'
            }`}
            title={fetchError ? 'Could not fetch analytics' : 'Completed survey responses'}
          >
            {completed != null ? `${completed} completed` : fetchError ? '— completed' : '…'}
          </span>
          <button
            onClick={() => {
              setDraft(url)
              setEditing(true)
            }}
            className="text-muted-foreground hover:text-foreground text-xs px-2 py-2 transition-colors"
            title="Change link"
          >
            ✎
          </button>
        </div>
      )}

      {showInput && (
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="Paste Campaign Manager URL"
            className="flex-1 bg-muted border border-dashed border-border rounded-lg px-3 py-2 text-sm text-foreground/80 placeholder:text-muted-foreground focus:outline-none focus:border-ring transition-colors"
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
          <button
            onClick={handleSave}
            disabled={!editing && !draft.trim()}
            className="bg-muted hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed text-foreground text-xs px-3 py-2 rounded-lg transition-colors"
          >
            Save
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd survey-ops-tracker
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/project/CampaignManagerLink.tsx
git commit -m "feat(ui): CampaignManagerLink component with live N completed badge"
```

---

## Task 5: Wire into the project detail page

**Files:**
- Modify: `app/(app)/projects/[id]/page.tsx`

Add the import and render it in the Links & Setup tab, right after `<SlackChannel>`.

- [ ] **Step 1: Add the import**

Near the top of the file, alongside the other project component imports:

```ts
import { CampaignManagerLink } from '@/components/project/CampaignManagerLink'
```

- [ ] **Step 2: Render the component**

Find this block in the Links & Setup tab section (around line 393):

```tsx
<SlackChannel projectId={project.id} url={project.slack_channel_url ?? null} />
```

Add the new component immediately after it:

```tsx
<SlackChannel projectId={project.id} url={project.slack_channel_url ?? null} />

<CampaignManagerLink
  projectId={project.id}
  url={project.campaign_manager_url ?? null}
/>
```

- [ ] **Step 3: Verify the page compiles and loads**

```bash
cd survey-ops-tracker
npm run dev
```

Open a project → Links & Setup tab. You should see the new "Campaign Manager" card below the Slack Channel card. Paste `https://main.d3plqclbjc4ah9.amplifyapp.com/campaigns/35` and save. The N completed badge should appear and show `36 completed` (or `— completed` if auth fails).

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/projects/\[id\]/page.tsx
git commit -m "feat(project): add CampaignManagerLink to Links & Setup tab"
```

---

## Self-Review

**Spec coverage:**
- ✅ Store Campaign Manager URL at the project level
- ✅ Parse campaign ID from URL
- ✅ Fetch N completed via server-side proxy (no CORS)
- ✅ Display N completed as a badge next to the link
- ✅ Graceful degradation if fetch fails (auth or network)
- ✅ Editable URL (same pattern as SlackChannel)

**Auth fallback:** If the Campaign Manager API requires auth, `completed` stays `null` and the badge shows `— completed`. No crash, no hang. The user still gets the clickable link.

**No placeholders:** All code blocks are complete.
