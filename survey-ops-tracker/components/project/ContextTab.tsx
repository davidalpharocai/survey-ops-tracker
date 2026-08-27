'use client'

import { useState } from 'react'
import { parseISO } from 'date-fns'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { Skeleton } from '@/components/shared/Skeleton'
import { fmtNum } from '@/lib/utils/number'
import { daysAgoLabel, daysSince } from '@/lib/utils/date'
import type { SurveyProject } from '@/lib/hooks/useProjects'
import {
  contextView,
  useProjectContext,
  useRefreshProjectContext,
  useSetContextTopics,
  type ContextSource,
  type ContextTopicKind,
  type ProjectContext,
} from '@/lib/hooks/useProjectContext'

/**
 * The Context tab — why this study exists, and what moved while it was in field.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERYTHING RENDERED HERE IS UNTRUSTED CONTENT FROM THE OPEN WEB. The summary,
 * every source TITLE, every source NOTE and every source URL were written by
 * whoever owns the page we read. A source title is attacker-controlled the moment
 * a page is; treat it as hostile input.
 *
 * Consequences, all deliberate, none of them safe to "improve" away:
 *   - Text is rendered as TEXT. React escapes it. There is NO
 *     dangerouslySetInnerHTML in this file, no markdown-to-HTML library, no
 *     innerHTML, and no component that takes an HTML string. Do not add one.
 *     briefBlocks() below reads a leading "#", "- " or a wholly-bold line ONLY to
 *     pick a CSS class and an element type; the content of every block still
 *     lands in the DOM as a text node, and the <ul>/<li> we build is built out of
 *     React elements, never out of parsed markup.
 *   - Links go through safeHref(): an href IS executable, so anything that is not
 *     http/https (javascript:, data:, vbscript:, ...) is refused and the source is
 *     shown as inert text instead. Every external link carries
 *     rel="noopener noreferrer".
 *   - Nothing on this page turns fetched text into an action. No fetched string
 *     is ever used to choose a handler, build a request, or reach the in-app
 *     assistant (lib/assistant/engine.ts), which holds WRITE tools.
 * See the matching note in lib/hooks/useProjectContext.ts, where it is stored,
 * and the header of supabase/migrations/083_project_context.sql.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The tab also has to be honest about WHICH state it is in — see contextView()
 * in the hook. A stale brief shown as if it were current, or a summary with no
 * sources shown as if it were corroborated, is worse than no tab at all.
 */

/**
 * How often a project's brief is actually rebuilt.
 *
 * The Vercel cron runs DAILY (vercel.json → /api/cron/project-context), but the
 * job skips any row younger than CONTEXT_FRESH_HOURS = 72 (lib/server/
 * projectContext.ts). So the real, user-visible cadence is every three days, and
 * every word on this tab has to say three days rather than "nightly" — copy that
 * promises a fresher brief than the job delivers is how somebody trusts a stale
 * one. Not imported from lib/server on purpose: this is a client component.
 */
const REFRESH_CADENCE_DAYS = 3

const TIP = {
  header:
    'Background reading on this project, rebuilt about every 3 days: why the study was commissioned, plus anything notable that happened while it was in field. It is here for QA and for briefing yourself before a call. It is INTERNAL — pulled from the open web, not verified by us, and never something to paste into a client deliverable. Read the source before you repeat a claim.',
  origin:
    'What appears to have sparked this study — an earnings call remark, a filing, a regulatory move, a competitor launch — and then anything that moved during the field window. Knowing WHY a client asked the question changes how you read the answers. Every claim should be traceable to one of the sources below.',
  sources:
    'Every link behind the text above. Opens in a new tab. Nothing here is checked by us, so click through before you rely on a claim — and mind the date: an article can be about the right company and the wrong year.',
  topics:
    'What the search actually looks for. Fix anything wrong here and the next refresh improves — this list is the main quality lever on the whole tab.',
  companies:
    'Named subjects — the companies, funds, agencies or people the study is ABOUT. Tracked separately from keywords because an entity search reaches investor-relations pages, filings and earnings-call transcripts, which is usually where a study was really sparked. The Airbnb study came out of an earnings call, not a news story. If a chip here is not a real company — a fragment of the project title, a segment name like “Considerers” — remove it: it is spending searches on nothing.',
  keywords:
    'Themes and phrases — the market, the behaviour, the policy. These reach trade press and commentary rather than company primary sources.',
  generated:
    'When this briefing was written. It only moves when a NEW brief is produced, so it is the honest age of what you are reading. Briefs rebuild about every 3 days, so anything older than a week means runs have been failing — and a month-old brief about a fast-moving subject is close to worthless.',
  attempted:
    'When a refresh last TRIED, whether or not it worked. If this is recent and the brief above is old, every attempt since has failed.',
  auto: 'Suggested automatically from this project’s own fields (client, name, audience, objective) and re-derived on every refresh, about every 3 days. Nobody has ruled on this list yet, so it is a guess — correcting it is the highest-value edit on this tab.',
  human:
    'Set by someone on the team. The refresh never touches an edited list — it keeps suggesting in the background, and you can go back to its suggestions with “Use suggestions”.',
  model: 'Which model wrote this briefing. Quality is only comparable between briefs from the same model.',
  uncited:
    'This link is something the search returned, NOT something the briefing cited. It is here so you can see what was looked at — it is not evidence for any sentence above.',
  note: 'What the briefing used this source for, in the model’s own words. Still web-derived text: click through before repeating it.',
}

const card = 'bg-card border border-border shadow-sm rounded-xl p-4'
const sectionTitle =
  'text-xs uppercase tracking-widest text-muted-foreground font-medium flex items-center'

/**
 * Only http/https survive. An href is executable, and every URL here came off the
 * open web — a `javascript:` source URL is a one-click script injection with the
 * user's session. Anything else returns null and the caller renders inert text.
 */
function safeHref(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

/** Publisher-ish label from a URL, for readers scanning the source list. */
function hostLabel(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function shortDate(iso: string | null): string | null {
  if (!iso) return null
  // parseISO, not new Date(): publication dates arrive date-only ("2026-06-09"),
  // which `new Date` reads as UTC midnight and then renders as the PREVIOUS day
  // for anyone west of UTC. parseISO reads a date-only string as local midnight
  // and a full timestamp as the instant it is. Anything unparseable (this text
  // came off the web) becomes null, not "Invalid Date".
  const d = parseISO(iso)
  if (Number.isNaN(d.getTime())) return null
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/** Words + a reading estimate, so "a quick one minute read" is checkable. */
function readingTime(text: string): { words: number; minutes: number } {
  const words = text.split(/\s+/).filter(Boolean).length
  return { words, minutes: Math.max(1, Math.round(words / 220)) }
}

/**
 * How much to distrust the brief purely on age.
 *
 * Calibrated to the REAL cadence (every 3 days, see REFRESH_CADENCE_DAYS), not to
 * a nightly one: a healthy brief is 0-4 days old (the daily cron only rebuilds
 * once the 72-hour window has lapsed, so day four is normal). Five days means a
 * run was skipped or failed. Two weeks means several have, and nothing in the
 * brief should be repeated without clicking through — three weeks used to render
 * as mild amber, which is exactly the "looks fresh when it is stale" failure.
 */
type Age = 'fresh' | 'aging' | 'stale'
function ageOf(iso: string | null): Age {
  if (!iso) return 'stale'
  const d = daysSince(iso)
  if (d >= 14) return 'stale'
  if (d >= 5) return 'aging'
  return 'fresh'
}
const AGE_CLASS: Record<Age, string> = {
  fresh: 'text-muted-foreground border-border',
  aging: 'text-amber-700 dark:text-amber-400 border-amber-500/40 bg-amber-500/10',
  stale: 'text-red-700 dark:text-red-400 border-red-500/40 bg-red-500/10',
}

/* -- reading the briefing as blocks, never as markup ----------------------- */

interface BriefBlock {
  kind: 'heading' | 'bullet' | 'para'
  text: string
}

/** A run of consecutive bullets becomes ONE list; prose stays a paragraph. */
export type BriefRun = { kind: 'bullets'; items: string[] } | { kind: 'para'; text: string }

export interface BriefSection {
  /** null for a brief (or a leading stretch of one) that has no heading at all. */
  heading: string | null
  runs: BriefRun[]
}

/**
 * Emphasis markers are stripped so a brief does not read as literal asterisks.
 * Character classes rather than `.+?` on purpose: this string came off the web,
 * can be 20k characters, and a lazy dot-any pair backtracks quadratically on
 * hostile input — a hang is a denial of service on the project page.
 */
function stripInlineMarkers(s: string): string {
  return s
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .trim()
}

/**
 * A line that is nothing but bold text is a section heading. The server writes
 * the field-window divider that way (`**During the field window**`, see
 * composeSummary in lib/server/projectContext.ts), and before this it rendered
 * as an ordinary paragraph — a heading that did not look like one.
 */
const BOLD_ONLY = /^(?:\*\*([^*\n]+)\*\*|__([^_\n]+)__):?$/

/**
 * Split the stored summary into blocks for rendering. A leading "#", a "- ", or a
 * wholly-bold line only ever selects a CSS class and an element type — the text
 * itself is handed to React as a child and escaped like everything else. This is
 * NOT a markdown renderer and must not grow into one: no links, no HTML, no tags.
 */
export function briefBlocks(summary: string): BriefBlock[] {
  const out: BriefBlock[] = []
  let para: string[] = []
  const flush = () => {
    if (!para.length) return
    const text = stripInlineMarkers(para.join(' '))
    if (text) out.push({ kind: 'para', text })
    para = []
  }
  for (const raw of summary.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    const heading = /^#{1,6}\s+(.+)$/.exec(line)
    if (heading) {
      flush()
      const text = stripInlineMarkers(heading[1])
      if (text) out.push({ kind: 'heading', text })
      continue
    }
    const bold = BOLD_ONLY.exec(line)
    if (bold) {
      flush()
      const text = (bold[1] ?? bold[2] ?? '').trim()
      if (text) out.push({ kind: 'heading', text })
      continue
    }
    const bullet = /^(?:[-*•]|\d{1,2}[.)])\s+(.+)$/.exec(line)
    if (bullet) {
      flush()
      const text = stripInlineMarkers(bullet[1])
      if (text) out.push({ kind: 'bullet', text })
      continue
    }
    para.push(line)
  }
  flush()
  return out
}

/**
 * Blocks -> sections, with consecutive bullets collapsed into one list.
 *
 * Three shapes have to survive this, because all three are live at once for the
 * first few days after the bullet prompt ships:
 *   · bullets under headings  — what the refresh writes from now on.
 *   · one prose paragraph     — every row already in production, until it
 *                               regenerates. Renders as prose, not as a
 *                               one-item list and not as an empty section.
 *   · a mix of both           — a heading with a paragraph and then bullets.
 * A heading with nothing under it is kept deliberately: the caller says "nothing
 * recorded" rather than silently dropping a section the model chose to open.
 */
export function briefSections(summary: string): BriefSection[] {
  const sections: BriefSection[] = []
  let current: BriefSection | null = null

  const ensure = () => {
    if (!current) {
      current = { heading: null, runs: [] }
      sections.push(current)
    }
    return current
  }

  for (const b of briefBlocks(summary)) {
    if (b.kind === 'heading') {
      current = { heading: b.text, runs: [] }
      sections.push(current)
      continue
    }
    const s = ensure()
    if (b.kind === 'bullet') {
      const last = s.runs[s.runs.length - 1]
      if (last && last.kind === 'bullets') last.items.push(b.text)
      else s.runs.push({ kind: 'bullets', items: [b.text] })
    } else {
      s.runs.push({ kind: 'para', text: b.text })
    }
  }

  // Drop a heading-less section that ended up with nothing in it (a summary of
  // only blank lines) — but keep an empty section that HAS a heading.
  return sections.filter(s => s.heading !== null || s.runs.length > 0)
}

/* -- topic chips ----------------------------------------------------------- */

const KIND_STYLE: Record<
  ContextTopicKind,
  { chip: string; ghost: string; dot: string; label: string; add: string }
> = {
  company: {
    chip: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/40',
    ghost: 'text-blue-700/70 dark:text-blue-300/70 border-blue-500/30',
    dot: 'bg-blue-500',
    label: 'Subject companies',
    add: 'Add a company, fund or agency the study is about. Separate several with commas.',
  },
  keyword: {
    chip: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/40',
    ghost: 'text-violet-700/70 dark:text-violet-300/70 border-violet-500/30',
    dot: 'bg-violet-500',
    label: 'Keywords',
    add: 'Add a theme or phrase to search for. Separate several with commas.',
  },
}

/* -- the tab --------------------------------------------------------------- */

export function ContextTab({ project }: { project: SurveyProject }) {
  const { data, isLoading, isError } = useProjectContext(project.id)
  const refresh = useRefreshProjectContext(project.id)
  const setTopics = useSetContextTopics(project.id)

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        {['h-40', 'h-24', 'h-28'].map((h, i) => (
          <div key={i} className={`${card} flex flex-col gap-3`}>
            <Skeleton className="h-3 w-32" />
            <Skeleton className={`w-full ${h}`} />
          </div>
        ))}
      </div>
    )
  }

  // The read itself failed for a reason that is NOT "the table isn't there" —
  // network, permissions, PostgREST. Don't dress that as "no background yet".
  if (isError) {
    return (
      <div className={`${card} flex flex-col gap-2`}>
        <h3 className={sectionTitle}>
          Context
          <InfoTooltip text={TIP.header} />
        </h3>
        <p className="text-sm text-foreground">Couldn&rsquo;t load the background for this project.</p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Reload the page. If it keeps happening the context store is unreachable — nothing else on
          this project is affected.
        </p>
      </div>
    )
  }

  const view = contextView(data, refresh.isPending)
  const ctx = data?.context ?? null

  // The store itself couldn't be read — today that means migration 083 hasn't
  // been applied. Say exactly that rather than showing an empty tab that looks
  // like "this project has no background".
  if (view.kind === 'unavailable') {
    return (
      <div className={`${card} flex flex-col gap-2`}>
        <h3 className={sectionTitle}>
          Context
          <InfoTooltip text={TIP.header} />
        </h3>
        <p className="text-sm text-foreground">Context isn&rsquo;t switched on yet.</p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          It needs the <span className="font-mono text-foreground">project_context</span> migration
          (083) applied in Supabase. Once it is, every active project gets a background brief here,
          rebuilt about every {REFRESH_CADENCE_DAYS} days — no setup per project.
        </p>
      </div>
    )
  }

  const hasSummary = view.hasSummary
  // The derivation reads the project's own fields. With no audience and no
  // objective it had almost nothing to work with, so the suggestions below are a
  // guess off the name alone — worth saying, not worth blocking on.
  const thinInputs = !project.audience?.trim() && !project.objective?.trim()
  // Automatic refresh covers ACTIVE projects only. An archived one keeps whatever
  // it last had; the manual button still works.
  const inactive = project.status === 'Closed' || project.status === 'Cancelled'
  const age = ageOf(ctx?.generated_at ?? null)
  // Before the first generation there is no row, so the chips come from what the
  // server says it WOULD search (useProjectContext fetches them). Without this
  // the most valuable moment to correct the machine shows an empty list.
  const suggested = data?.suggested

  /**
   * Send BOTH override lists every time, because the payload is the complete
   * desired state (see the hook). Only the override columns are ever written:
   * auto_topics / auto_companies stay the machine's, and effective_* are
   * GENERATED and cannot be written at all.
   */
  function commitOverride(which: ContextTopicKind, next: string[] | null) {
    setTopics.mutate({
      topics_override: which === 'keyword' ? next : ctx?.topics_override ?? null,
      companies_override: which === 'company' ? next : ctx?.companies_override ?? null,
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header: what this is, how old it is, and the manual control. */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground flex items-center">
            Context
            <InfoTooltip text={TIP.header} />
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Internal background reading — from the open web, unverified, never for a client
            deliverable.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Freshness ctx={ctx} age={age} />
          <button
            onClick={() => refresh.mutate({ force: hasSummary })}
            disabled={view.busy || setTopics.isPending}
            title={
              hasSummary
                ? 'Search again now and rebuild this brief from the topics below'
                : 'Build this brief now instead of waiting for the next scheduled run'
            }
            className="text-sm border border-border text-muted-foreground hover:text-foreground hover:border-ring disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg transition-colors"
          >
            {view.busy ? 'Refreshing…' : hasSummary ? '↻ Refresh' : 'Generate now'}
          </button>
        </div>
      </div>

      {/* In-flight. Sits ABOVE the old brief, which stays readable meanwhile. */}
      {view.kind === 'generating' && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl px-4 py-2.5 text-sm text-blue-700 dark:text-blue-300 flex items-center gap-2">
          <span aria-hidden="true" className="animate-pulse">
            ✦
          </span>
          Searching and rebuilding this brief. It usually takes under a minute — keep this tab open.
        </div>
      )}

      {/* Failure. When an older brief exists it stays on screen BELOW this: an
          out-of-date brief you know is out of date beats a blank tab. */}
      {view.showFailure && (
        <div
          className={`rounded-xl px-4 py-3 border ${
            hasSummary ? 'bg-amber-500/10 border-amber-500/40' : 'bg-red-500/10 border-red-500/40'
          }`}
        >
          <p
            className={`text-sm font-medium ${
              hasSummary ? 'text-amber-700 dark:text-amber-300' : 'text-red-700 dark:text-red-300'
            }`}
          >
            {hasSummary ? 'The last refresh failed' : 'Couldn’t build this brief'}
          </p>
          {/* The failure message can carry text from a fetched page. Rendered as
              text, same rule as everything else on this tab. */}
          <p className="text-sm text-foreground/80 mt-0.5 whitespace-pre-wrap break-words">
            {ctx?.error ?? 'No reason was recorded.'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {hasSummary
              ? `Showing the last good version${
                  ctx?.generated_at ? ` from ${shortDate(ctx.generated_at) ?? 'earlier'}` : ''
                }${
                  ctx?.last_refreshed_at
                    ? `, last attempted ${daysAgoLabel(ctx.last_refreshed_at)}`
                    : ''
                }. Check the topics below, then refresh.`
              : 'Check the topics below — a wrong or empty topic list is the usual cause — then try again.'}
          </p>
        </div>
      )}

      {/* AGE. The brief can be perfectly successful and still too old to use, and
          that has to be as loud as a failure. Hushed while a refresh is running
          and while the failure banner is up — both already say more than this. */}
      {hasSummary && !view.showFailure && view.kind !== 'generating' && age !== 'fresh' && (
        <AgeWarning generatedAt={ctx?.generated_at ?? null} age={age} />
      )}

      {/* Uncorroborated: there IS a brief, but nothing came back to back it up.
          Deliberately loud — this must not read like a normal briefing. */}
      {view.kind === 'uncorroborated' && (
        <div className="rounded-xl px-4 py-3 border border-amber-500/50 bg-amber-500/10">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
            Unverified — nothing was found to back this up
          </p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            The last run produced the text below but could not verify a single source behind it. Any
            links under Sources are raw search hits, not citations. Treat every sentence as a hint to
            check yourself, not as a fact, and do not repeat any of it. Correcting the topics at the
            bottom of this tab is the usual fix.
          </p>
        </div>
      )}

      {inactive && (
        <p className="text-xs text-muted-foreground">
          This project is archived, so it&rsquo;s no longer picked up by the automatic refresh.
          Anything below is what it last had; the refresh button still works.
        </p>
      )}

      {/* 1. WHAT'S DRIVING THIS — the primary section, first on the page. */}
      <OriginSection
        summary={ctx?.summary ?? null}
        model={ctx?.model ?? null}
        generating={view.kind === 'generating'}
        nothingFound={view.kind === 'nothing_found'}
        uncorroborated={view.kind === 'uncorroborated'}
        launchDate={project.launch_date}
        deliverDate={project.deliver_date}
      />

      {/* 2. SOURCES — shown alongside any brief, even when the list came back
          empty. A brief with nothing behind it is exactly the thing an analyst
          needs told, not hidden. */}
      {ctx && (hasSummary || ctx.sources.length > 0) && <SourcesSection sources={ctx.sources} />}

      {/* 3. TOPICS — always editable, including before the first generation, so
          an analyst can prime the search rather than wait for a bad guess. */}
      <div className={`${card} flex flex-col gap-4`}>
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h3 className={sectionTitle}>
            Topics being tracked
            <InfoTooltip text={TIP.topics} />
          </h3>
          <p className="text-[11px] text-muted-foreground">
            Wrong chip? Remove it — one click, no confirmation.
          </p>
        </div>

        {thinInputs && (
          <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
            This project has no audience and no objective recorded, so there was little to suggest
            topics from — expect the lists below to be thin or wrong, and correct them.
          </p>
        )}

        <TopicGroup
          kind="company"
          tooltip={TIP.companies}
          auto={ctx?.auto_companies ?? suggested?.companies ?? []}
          override={ctx?.companies_override ?? null}
          setBy={ctx?.topics_set_by ?? null}
          setAt={ctx?.topics_set_at ?? null}
          disabled={setTopics.isPending || view.busy}
          onChange={next => commitOverride('company', next)}
          placeholder="e.g. Novo Nordisk, Eli Lilly"
        />
        <TopicGroup
          kind="keyword"
          tooltip={TIP.keywords}
          auto={ctx?.auto_topics ?? suggested?.topics ?? []}
          override={ctx?.topics_override ?? null}
          setBy={ctx?.topics_set_by ?? null}
          setAt={ctx?.topics_set_at ?? null}
          disabled={setTopics.isPending || view.busy}
          onChange={next => commitOverride('keyword', next)}
          placeholder="e.g. GLP-1 weight-loss adherence"
        />

        <div className="flex items-center gap-4 text-[11px] text-muted-foreground pt-2 border-t border-border flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-6 border-b border-dashed border-muted-foreground/60" />
            suggested automatically, every {REFRESH_CADENCE_DAYS} days
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-6 border-b border-solid border-muted-foreground/60" />
            set by the team — never overwritten
          </span>
          <span className="ml-auto">
            {fmtNum(
              (ctx?.effective_companies.length ?? 0) + (ctx?.effective_topics.length ?? 0),
            )}{' '}
            searched
          </span>
        </div>
      </div>
    </div>
  )
}

/* -- header freshness ------------------------------------------------------ */

/**
 * Two different clocks, shown as two different things on purpose.
 *   generated_at      = the age of the words you are reading.
 *   last_refreshed_at = when we last TRIED.
 * A run of failures gives a recent attempt and an old brief, and an analyst who
 * is told only the attempt will trust a stale brief.
 */
function Freshness({ ctx, age }: { ctx: ProjectContext | null; age: Age }) {
  const generated = ctx?.generated_at ?? null
  const attempted = ctx?.last_refreshed_at ?? null
  // Only worth showing the attempt separately when it is not the same event.
  const attemptDiffers =
    !!attempted && (!generated || Math.abs(Date.parse(attempted) - Date.parse(generated)) > 60_000)

  return (
    <div className="flex flex-col items-end">
      <span
        className={`text-xs flex items-center border rounded-lg px-2 py-1 ${
          generated ? AGE_CLASS[age] : 'text-muted-foreground border-border'
        } ${age === 'stale' && generated ? 'font-semibold' : ''}`}
      >
        {generated ? (
          <>
            Brief from {shortDate(generated) ?? '—'}
            <span className="ml-1 font-medium">({daysAgoLabel(generated)})</span>
          </>
        ) : (
          'No brief yet'
        )}
        <InfoTooltip text={TIP.generated} />
      </span>
      {attemptDiffers && (
        <span className="text-[11px] text-muted-foreground flex items-center mt-0.5">
          last tried {daysAgoLabel(attempted)}
          <InfoTooltip text={TIP.attempted} />
        </span>
      )}
    </div>
  )
}

/**
 * A brief that succeeded and then went out of date. Full-width and coloured,
 * because the corner stamp alone is easy to read past — and reading past it is
 * how a three-week-old briefing gets repeated on a client call.
 */
function AgeWarning({ generatedAt, age }: { generatedAt: string | null; age: Age }) {
  const days = daysSince(generatedAt)
  const stale = age === 'stale'
  return (
    <div
      className={`rounded-xl px-4 py-3 border ${
        stale ? 'bg-red-500/10 border-red-500/40' : 'bg-amber-500/10 border-amber-500/40'
      }`}
    >
      <p
        className={`text-sm font-medium ${
          stale ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'
        }`}
      >
        {stale
          ? `Out of date — this brief is ${fmtNum(days)} days old`
          : `This brief is ${fmtNum(days)} days old`}
      </p>
      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
        {stale
          ? `A brief rebuilds about every ${REFRESH_CADENCE_DAYS} days, so runs have been failing or this project stopped being picked up. Don’t repeat anything below without opening the source. Refresh it, and check the topics, before you use it.`
          : `A brief rebuilds about every ${REFRESH_CADENCE_DAYS} days, so a run has been skipped or has failed. Nothing below is necessarily wrong — it just may not be current.`}
      </p>
    </div>
  )
}

/* -- 1. What's driving this ------------------------------------------------ */

function OriginSection({
  summary,
  model,
  generating,
  nothingFound,
  uncorroborated,
  launchDate,
  deliverDate,
}: {
  summary: string | null
  model: string | null
  generating: boolean
  nothingFound: boolean
  uncorroborated: boolean
  launchDate: string | null
  deliverDate: string | null
}) {
  const from = shortDate(launchDate)
  const to = shortDate(deliverDate)
  const windowLabel = from && to ? `${from} – ${to}` : from ? `from ${from}` : to ? `to ${to}` : null

  if (!summary) {
    return (
      <div className={`${card} flex flex-col gap-2`}>
        <h3 className={sectionTitle}>
          What&rsquo;s driving this
          <InfoTooltip text={TIP.origin} />
        </h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {generating
            ? 'Building the first brief now.'
            : nothingFound
              ? 'The last run searched and found nothing worth reporting. That is a real answer, not a failure — but if the topics below look wrong, fix them and refresh.'
              : `Nothing generated yet. The scheduled refresh will search the topics below and write a one-minute brief here on why this study exists — an earnings remark, a filing, a competitor move — with a link behind every claim. It runs about every ${REFRESH_CADENCE_DAYS} days; use Generate now if you don’t want to wait.`}
        </p>
      </div>
    )
  }

  const { words, minutes } = readingTime(summary)
  const sections = briefSections(summary)
  // Rows written before the bullet prompt shipped are a single prose paragraph.
  // They render fine as prose — this just tells the reader why this one looks
  // different from the next project's, instead of leaving them to wonder.
  const hasBullets = sections.some(s => s.runs.some(r => r.kind === 'bullets'))

  return (
    <div
      className={`${card} flex flex-col gap-3 ${
        uncorroborated ? 'border-amber-500/50 bg-amber-500/5' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className={sectionTitle}>
          What&rsquo;s driving this
          <InfoTooltip text={TIP.origin} />
          {uncorroborated && (
            <span className="ml-2 text-[10px] uppercase tracking-wide font-semibold text-amber-700 dark:text-amber-300 bg-amber-500/15 border border-amber-500/40 rounded px-1.5 py-0.5 normal-case">
              unverified
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          {windowLabel && (
            <span
              className="text-[11px] text-teal-700 dark:text-teal-300 bg-teal-500/10 border border-teal-500/30 rounded px-1.5 py-0.5"
              title="The field window — launch date to deliver date. The second half of the brief covers what moved inside it."
            >
              field {windowLabel}
            </span>
          )}
          <span
            className="text-[11px] text-muted-foreground"
            title="Estimated at 220 words a minute"
          >
            ~{minutes} min read · {fmtNum(words)} words
          </span>
        </div>
      </div>

      {/* Sections, bullets and paragraphs — all built from React elements out of
          plain strings. Nothing here parses or injects markup; see the file
          header. Every `text` below is a React text child. */}
      <div className="flex flex-col gap-3.5">
        {sections.map((s, i) => (
          <section key={i} className="flex flex-col gap-2">
            {s.heading && (
              <h4 className="text-[11px] font-semibold text-foreground uppercase tracking-wide break-words">
                {s.heading}
              </h4>
            )}
            {s.runs.length === 0 && (
              <p className="text-sm text-muted-foreground italic">
                Nothing was recorded under this heading.
              </p>
            )}
            {s.runs.map((run, j) =>
              run.kind === 'bullets' ? (
                <ul key={j} className="list-none flex flex-col gap-2">
                  {run.items.map((t, k) => (
                    <li key={k} className="flex gap-2.5 text-sm text-foreground/90 leading-relaxed">
                      <span
                        aria-hidden="true"
                        className="mt-[0.45rem] w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0"
                      />
                      <span className="min-w-0 break-words">{t}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p key={j} className="text-sm text-foreground/90 leading-relaxed break-words">
                  {run.text}
                </p>
              ),
            )}
          </section>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap pt-1">
        {!hasBullets && (
          <p className="text-[11px] text-muted-foreground">
            Older prose format — the next refresh rewrites this as bullets.
          </p>
        )}
        {model && (
          <p className="text-[11px] text-muted-foreground flex items-center ml-auto">
            Written by {model}
            <InfoTooltip text={TIP.model} />
          </p>
        )}
      </div>
    </div>
  )
}

/* -- 2. Sources ------------------------------------------------------------ */

function SourcesSection({ sources }: { sources: ContextSource[] }) {
  // A source the briefing CITED is evidence. A source the search merely returned
  // is not, and the server marks the difference (reconcileSources in
  // lib/server/projectContext.ts). Showing them identically is the one thing that
  // would make this whole card dishonest.
  const uncited = sources.filter(s => s.uncorroborated).length
  const allUncited = sources.length > 0 && uncited === sources.length

  return (
    <div
      className={`${card} flex flex-col gap-3 ${
        allUncited ? 'border-amber-500/50 bg-amber-500/5' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className={sectionTitle}>
          Sources
          <InfoTooltip text={TIP.sources} />
        </h3>
        <span className="text-[11px] text-muted-foreground">
          {fmtNum(sources.length)} links
          {uncited > 0 && (
            <span className="text-amber-700 dark:text-amber-400">
              {' '}
              · {fmtNum(uncited)} not cited
            </span>
          )}
        </span>
      </div>
      {sources.length === 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
          No sources came back with this brief, so nothing above is traceable. Treat it as a hint,
          not a fact, and refresh once the topics below look right.
        </p>
      )}
      {allUncited && (
        <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
          None of these were cited by the briefing — they are the raw search hits the run came back
          with, kept so you can see what was looked at. Nothing above is traceable to them.
        </p>
      )}
      <ol className="flex flex-col gap-2.5">
        {sources.map((s, i) => {
          const href = safeHref(s.url)
          const host = href ? hostLabel(href) : null
          const published = shortDate(s.published_at)
          return (
            <li key={`${s.url}-${i}`} className="flex gap-2.5 text-sm">
              <span className="text-[11px] text-muted-foreground/70 font-mono pt-0.5 shrink-0 w-5 text-right">
                {i + 1}
              </span>
              <div className="min-w-0">
                {/* The TITLE is attacker-controlled if the page is — it is text,
                    and the href is protocol-checked. A URL we won't link is shown
                    as inert text so the analyst can still see what was found. */}
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline break-words"
                    title="Opens in a new tab"
                  >
                    {s.title}
                  </a>
                ) : (
                  <span
                    className="text-muted-foreground break-words"
                    title="Not linked — this source's address isn't a normal http/https web link"
                  >
                    {s.title} (unlinkable)
                  </span>
                )}
                <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap mt-0.5">
                  {(s.publisher || host) && <span className="break-all">{s.publisher || host}</span>}
                  {published && (s.publisher || host) && (
                    <span className="text-muted-foreground/50">·</span>
                  )}
                  {published && <span>{published}</span>}
                  {s.uncorroborated && (
                    <span
                      className="text-[10px] text-amber-700 dark:text-amber-300 bg-amber-500/15 border border-amber-500/40 rounded px-1.5 py-0.5 flex items-center"
                      title="Returned by the search, not cited by the briefing"
                    >
                      search hit — not cited
                      <InfoTooltip text={TIP.uncited} />
                    </span>
                  )}
                </div>
                {/* Web-derived text, written by the model ABOUT a web page. Text
                    only, like everything else on this tab. */}
                {s.note && (
                  <p className="text-[11px] text-muted-foreground/90 mt-1 leading-relaxed break-words">
                    {s.note}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/* -- 3. Topics ------------------------------------------------------------- */

/**
 * One list — companies OR keywords — over the 083 auto/override split.
 *
 * The rules this component exists to keep:
 *   · Only the OVERRIDE column is ever written. The machine's suggestions
 *     (`auto`) are read-only here and keep updating underneath.
 *   · `override === null` means nobody has ruled, so the auto list is what runs.
 *     The chips are drawn dashed to say so.
 *   · The FIRST edit copies what is currently on screen into the override — that
 *     is the point at which a person takes ownership of the list.
 *   · `override === []` is a real answer ("there are none — search nothing"),
 *     reachable by removing the last chip, and NOT the same as null. The empty
 *     state says WHICH of the two it is in words, so removing the last chip is
 *     never ambiguous, and "Use suggestions" is right next to it.
 *   · "Use suggestions" sets the override back to null. Without it, one edit
 *     would be a one-way door: the refresh would keep refining `auto` and nobody
 *     would ever see it again.
 *
 * Correcting the machine is the whole point of this control, so adding is as
 * cheap as removing: one click on a suggestion the override dropped, or a
 * comma-separated list typed in one go, and Enter keeps the field open.
 */
function TopicGroup({
  kind,
  tooltip,
  auto,
  override,
  setBy,
  setAt,
  disabled,
  onChange,
  placeholder,
}: {
  kind: ContextTopicKind
  tooltip: string
  auto: string[]
  override: string[] | null
  setBy: string | null
  setAt: string | null
  disabled: boolean
  onChange: (next: string[] | null) => void
  placeholder: string
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const style = KIND_STYLE[kind]

  const human = override !== null
  const shown = override ?? auto
  const noun = kind === 'company' ? 'subject company' : 'keyword'
  const plural = kind === 'company' ? 'companies' : 'keywords'
  // What the job would suggest that the human list doesn't have. Shown as
  // one-click chips so an override never silently hides a newly relevant subject
  // AND putting one back costs a single click.
  const lower = new Set(shown.map(s => s.toLowerCase()))
  const alsoSuggested = human ? auto.filter(a => !lower.has(a.toLowerCase())) : []

  /**
   * Append whatever is in the draft. Commas split, because "Novo Nordisk, Eli
   * Lilly" is how anybody types two of these, and one payload for both is also
   * the SAFE way to add two: every write here is the complete desired list, and
   * `disabled` (setTopics.isPending) is what stops a second edit being built on
   * top of a list the server has not answered with yet. Two sequential adds from
   * a stale `shown` would silently drop the first one — hence commas, and hence
   * the field closing on Enter rather than staying open for a second round.
   *
   * Duplicates are dropped case-insensitively, and a draft that adds nothing new
   * writes nothing at all.
   */
  function commitDraft() {
    const parts = draft
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    setDraft('')
    setAdding(false)
    if (!parts.length) return
    const seen = new Set(lower)
    const next = [...shown]
    for (const p of parts) {
      const k = p.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      next.push(p)
    }
    if (next.length === shown.length) return
    onChange(next)
  }

  function adopt(label: string) {
    if (lower.has(label.toLowerCase())) return
    onChange([...shown, label])
  }

  function remove(label: string) {
    onChange(shown.filter(l => l !== label))
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center">
          <span
            aria-hidden="true"
            className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${style.dot}`}
          />
          {style.label}
          <InfoTooltip text={tooltip} />
        </span>
        {human ? (
          <span
            className="text-[10px] text-foreground/70 border border-border rounded px-1.5 py-0.5 flex items-center"
            title={
              setBy
                ? `Set by ${setBy}${setAt ? ` on ${shortDate(setAt) ?? 'an earlier date'}` : ''}`
                : 'Set by the team'
            }
          >
            set by {setBy ?? 'the team'}
            <InfoTooltip text={TIP.human} />
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground border border-dashed border-border rounded px-1.5 py-0.5 flex items-center">
            suggested
            <InfoTooltip text={TIP.auto} />
          </span>
        )}
        {human && (
          <button
            onClick={() => onChange(null)}
            disabled={disabled}
            title="Throw away this edited list and go back to what the automatic refresh suggests. It keeps suggesting in the background either way."
            className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40 underline underline-offset-2 transition-colors"
          >
            Use suggestions
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {shown.length === 0 && !adding && (
          <span
            className={`text-xs ${
              human ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground/60'
            }`}
          >
            {human
              ? `none — the team ruled there are no ${plural} to search, so the next refresh searches nothing here. Not the same as “undecided”: “Use suggestions” above puts it back to the machine’s list.`
              : 'nothing suggested — add one'}
          </span>
        )}
        {shown.map(label => (
          <span
            key={label}
            className={`inline-flex items-center gap-1 text-xs pl-2 pr-1 py-1 rounded-lg border ${style.chip} ${
              human ? 'border-solid' : 'border-dashed'
            }`}
            title={human ? TIP.human : TIP.auto}
          >
            {/* Suggestions are derived from the project's own fields, but the
                refresh job writes them too — text only, like everything else. */}
            <span className="break-words">{label}</span>
            <button
              onClick={() => remove(label)}
              disabled={disabled}
              aria-label={`Stop tracking ${label}`}
              title="Stop tracking this — one click, no confirmation. The next refresh ignores it."
              className="w-4 h-4 inline-flex items-center justify-center rounded opacity-60 hover:opacity-100 hover:bg-foreground/10 disabled:opacity-30 transition-all"
            >
              ✕
            </button>
          </span>
        ))}
        {adding ? (
          <input
            autoFocus
            value={draft}
            placeholder={placeholder}
            aria-label={`Add a ${noun}`}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => commitDraft()}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitDraft()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setDraft('')
                setAdding(false)
              }
            }}
            className="w-56 bg-muted border border-border rounded-lg px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            disabled={disabled}
            title={style.add}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 border border-dashed border-border rounded-lg px-2 py-1 transition-colors"
          >
            + add
          </button>
        )}
      </div>

      {alsoSuggested.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">
            Also suggested, not searched:
            <InfoTooltip
              text={`The automatic refresh still suggests these every ${REFRESH_CADENCE_DAYS} days, but this list is set by the team so they are not searched. Click one to put it back.`}
            />
          </span>
          {alsoSuggested.map(label => (
            <button
              key={label}
              onClick={() => adopt(label)}
              disabled={disabled}
              aria-label={`Track ${label}`}
              title="Add this back to the searched list"
              className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-lg border border-dashed ${style.ghost} hover:bg-foreground/5 disabled:opacity-40 transition-colors`}
            >
              <span className="break-words">{label}</span>
              <span aria-hidden="true" className="opacity-70">
                +
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
