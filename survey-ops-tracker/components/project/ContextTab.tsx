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
 * every source TITLE and every source URL were written by whoever owns the page
 * we read. A source title is attacker-controlled the moment a page is; treat it
 * as hostile input.
 *
 * Consequences, all deliberate, none of them safe to "improve" away:
 *   - Text is rendered as TEXT. React escapes it. There is NO
 *     dangerouslySetInnerHTML in this file, no markdown-to-HTML, no innerHTML,
 *     and no component that takes an HTML string. Do not add one. The block
 *     splitter below reads a leading "#" or "- " only to pick a CSS class; the
 *     content of every block still lands in the DOM as a text node.
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

const TIP = {
  header:
    'Background reading on this project, rebuilt by a nightly job: why the study was commissioned, plus anything notable that happened while it was in field. It is here for QA and for briefing yourself before a call. It is INTERNAL — pulled from the open web, not verified by us, and never something to paste into a client deliverable. Read the source before you repeat a claim.',
  origin:
    'What appears to have sparked this study — an earnings call remark, a filing, a regulatory move, a competitor launch — and then anything that moved during the field window. Knowing WHY a client asked the question changes how you read the answers. Every claim should be traceable to one of the sources below.',
  sources:
    'Every link behind the text above. Opens in a new tab. Nothing here is checked by us, so click through before you rely on a claim — and mind the date: an article can be about the right company and the wrong year.',
  topics:
    'What the nightly search actually looks for. Fix anything wrong here and the next refresh improves — this list is the main quality lever on the whole tab.',
  companies:
    'Named subjects — the companies, funds, agencies or people the study is ABOUT. Tracked separately from keywords because an entity search reaches investor-relations pages, filings and earnings-call transcripts, which is usually where a study was really sparked. The Airbnb study came out of an earnings call, not a news story.',
  keywords:
    'Themes and phrases — the market, the behaviour, the policy. These reach trade press and commentary rather than company primary sources.',
  generated:
    'When this briefing was written. It only moves when a NEW brief is produced, so it is the honest age of what you are reading. A month-old brief about a fast-moving subject is close to worthless — refresh it.',
  attempted:
    'When a refresh last TRIED, whether or not it worked. If this is recent and the brief above is old, every attempt since has failed.',
  auto: 'Suggested automatically from this project’s own fields (client, name, audience, objective) and re-derived every night. Nobody has ruled on this list yet.',
  human:
    'Set by someone on the team. The nightly job never touches an edited list — it keeps suggesting in the background, and you can go back to its suggestions with “Use suggestions”.',
  model: 'Which model wrote this briefing. Quality is only comparable between briefs from the same model.',
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
 * How much to distrust the brief purely on age. The nightly job means a healthy
 * brief is 0-1 days old; a fortnight means the job has not landed one in a
 * fortnight, and a month means do not repeat anything in it without clicking
 * through.
 */
type Age = 'fresh' | 'aging' | 'stale'
function ageOf(iso: string | null): Age {
  if (!iso) return 'stale'
  const d = daysSince(iso)
  if (d >= 30) return 'stale'
  if (d >= 7) return 'aging'
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
 * Split the stored summary into blocks for rendering. A leading "#" or "- " only
 * ever selects a CSS class — the text itself is handed to React as a child and
 * escaped like everything else. This is NOT a markdown renderer and must not
 * grow into one: no links, no HTML, no tags.
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

/* -- topic chips ----------------------------------------------------------- */

const KIND_STYLE: Record<
  ContextTopicKind,
  { chip: string; dot: string; label: string; add: string }
> = {
  company: {
    chip: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/40',
    dot: 'bg-blue-500',
    label: 'Subject companies',
    add: 'Add a company, fund or agency the study is about',
  },
  keyword: {
    chip: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/40',
    dot: 'bg-violet-500',
    label: 'Keywords',
    add: 'Add a theme or phrase to search for',
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
          (083) applied in Supabase. Once it is, every active project gets a nightly background
          brief here — no setup per project.
        </p>
      </div>
    )
  }

  const hasSummary = view.hasSummary
  // The derivation reads the project's own fields. With no audience and no
  // objective it had almost nothing to work with, so the suggestions below are a
  // guess off the name alone — worth saying, not worth blocking on.
  const thinInputs = !project.audience?.trim() && !project.objective?.trim()
  // Nightly refresh covers ACTIVE projects only. An archived one keeps whatever
  // it last had; the manual button still works.
  const inactive = project.status === 'Closed' || project.status === 'Cancelled'
  const age = ageOf(ctx?.generated_at ?? null)

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
                : 'Build this brief now instead of waiting for tonight’s run'
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

      {/* Uncorroborated: there IS a brief, but nothing came back to back it up.
          Deliberately loud — this must not read like a normal briefing. */}
      {view.kind === 'uncorroborated' && (
        <div className="rounded-xl px-4 py-3 border border-amber-500/50 bg-amber-500/10">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
            Unverified — nothing was found to back this up
          </p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            The last run produced the text below but could not verify a single source behind it.
            Treat every sentence as a hint to check yourself, not as a fact, and do not repeat any
            of it. Correcting the topics at the bottom of this tab is the usual fix.
          </p>
        </div>
      )}

      {inactive && (
        <p className="text-xs text-muted-foreground">
          This project is archived, so it&rsquo;s no longer picked up by the nightly refresh.
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
        <h3 className={sectionTitle}>
          Topics being tracked
          <InfoTooltip text={TIP.topics} />
        </h3>

        {thinInputs && (
          <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
            This project has no audience and no objective recorded, so there was little to suggest
            topics from — expect the lists below to be thin or wrong, and correct them.
          </p>
        )}

        <TopicGroup
          kind="company"
          tooltip={TIP.companies}
          auto={ctx?.auto_companies ?? []}
          override={ctx?.companies_override ?? null}
          setBy={ctx?.topics_set_by ?? null}
          setAt={ctx?.topics_set_at ?? null}
          disabled={setTopics.isPending || view.busy}
          onChange={next => commitOverride('company', next)}
          placeholder="e.g. Airbnb"
        />
        <TopicGroup
          kind="keyword"
          tooltip={TIP.keywords}
          auto={ctx?.auto_topics ?? []}
          override={ctx?.topics_override ?? null}
          setBy={ctx?.topics_set_by ?? null}
          setAt={ctx?.topics_set_at ?? null}
          disabled={setTopics.isPending || view.busy}
          onChange={next => commitOverride('keyword', next)}
          placeholder="e.g. short-term rental regulation"
        />

        <div className="flex items-center gap-4 text-[11px] text-muted-foreground pt-2 border-t border-border flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-6 border-b border-dashed border-muted-foreground/60" />
            suggested nightly
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-6 border-b border-solid border-muted-foreground/60" />
            set by the team
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
 * Three nights of failures give a recent attempt and an old brief, and an
 * analyst who is told only the attempt will trust a stale brief.
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
        }`}
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
              : 'Nothing generated yet. The nightly job will search the topics below and write a one-minute brief here on why this study exists — an earnings remark, a filing, a competitor move — with a link behind every claim. Use Generate now if you don’t want to wait.'}
        </p>
      </div>
    )
  }

  const { words, minutes } = readingTime(summary)
  const blocks = briefBlocks(summary)

  return (
    <div
      className={`${card} flex flex-col gap-2 ${
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

      {/* Blocks, not markup. Every `text` below is a React text child. */}
      <div className="flex flex-col gap-2">
        {blocks.map((b, i) =>
          b.kind === 'heading' ? (
            <h4
              key={i}
              className="text-xs font-semibold text-foreground uppercase tracking-wide mt-1.5 break-words"
            >
              {b.text}
            </h4>
          ) : b.kind === 'bullet' ? (
            <div key={i} className="flex gap-2 text-sm text-foreground/90 leading-relaxed">
              <span aria-hidden="true" className="text-muted-foreground shrink-0">
                •
              </span>
              <span className="break-words">{b.text}</span>
            </div>
          ) : (
            <p key={i} className="text-sm text-foreground/90 leading-relaxed break-words">
              {b.text}
            </p>
          ),
        )}
      </div>

      {model && (
        <p className="text-[11px] text-muted-foreground flex items-center pt-1">
          Written by {model}
          <InfoTooltip text={TIP.model} />
        </p>
      )}
    </div>
  )
}

/* -- 2. Sources ------------------------------------------------------------ */

function SourcesSection({ sources }: { sources: ContextSource[] }) {
  return (
    <div className={`${card} flex flex-col gap-3`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className={sectionTitle}>
          Sources
          <InfoTooltip text={TIP.sources} />
        </h3>
        <span className="text-[11px] text-muted-foreground">{fmtNum(sources.length)} links</span>
      </div>
      {sources.length === 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
          No sources came back with this brief, so nothing above is traceable. Treat it as a hint,
          not a fact, and refresh once the topics below look right.
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
                </div>
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
 *     (`auto`) are read-only here and keep updating nightly underneath.
 *   · `override === null` means nobody has ruled, so the auto list is what runs.
 *     The chips are drawn dashed to say so.
 *   · The FIRST edit copies what is currently on screen into the override — that
 *     is the point at which a person takes ownership of the list.
 *   · `override === []` is a real answer ("there are none — search nothing"),
 *     reachable by removing the last chip, and NOT the same as null.
 *   · "Use suggestions" sets the override back to null. Without it, one edit
 *     would be a one-way door: the nightly job would keep refining `auto` and
 *     nobody would ever see it again.
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
  // What the nightly job would suggest that the human list doesn't have. Shown
  // so an override never silently hides a newly relevant subject.
  const lower = new Set(shown.map(s => s.toLowerCase()))
  const alsoSuggested = human ? auto.filter(a => !lower.has(a.toLowerCase())) : []

  function add() {
    const clean = draft.trim()
    setDraft('')
    setAdding(false)
    if (!clean) return
    if (lower.has(clean.toLowerCase())) return
    onChange([...shown, clean])
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
            title="Throw away this edited list and go back to what the nightly job suggests. It keeps suggesting in the background either way."
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
              ? `none — the team ruled there are no ${
                  kind === 'company' ? 'companies' : 'keywords'
                } to search`
              : 'nothing suggested — add one'}
          </span>
        )}
        {shown.map(label => (
          <span
            key={label}
            className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border ${style.chip} ${
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
              title="Stop tracking this — the next refresh will ignore it"
              className="opacity-60 hover:opacity-100 disabled:opacity-30 transition-opacity"
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
            onBlur={add}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.blur()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setDraft('')
                setAdding(false)
              }
            }}
            className="w-48 bg-muted border border-border rounded-lg px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
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
        <p className="text-[11px] text-muted-foreground break-words">
          Not searched, still suggested nightly: {alsoSuggested.join(', ')}
        </p>
      )}
    </div>
  )
}
