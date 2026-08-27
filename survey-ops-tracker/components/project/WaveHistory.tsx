'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRerunSeries, useRerunCandidates, useLinkRerun } from '@/lib/hooks/useRerunLineage'
import {
  useRerunSeriesRecord,
  useRerunSeriesList,
  useRerunSeriesActions,
  useSeriesAddCandidates,
} from '@/lib/hooks/useRerunSeriesRecord'
import { WaveSeriesView } from '@/components/reruns/WaveSeriesView'
import { toast } from '@/lib/utils/toast'

type P = {
  id: string
  client: string
  project_name: string
  rerun_series_id: string | null
  rerun_number: number | null
  /** First-class rerun_series link (migration 073). When set, this wave's
   * history reads through the new series record instead of the legacy
   * rerun_series_id root-pointer lineage. */
  series_id?: string | null
}

// The rerun-series history for a project: every wave in the series (original +
// reruns), in order, with a way to link an ad-hoc rerun to its original or
// detach one. Sits on the project detail page. A project with `series_id` set
// belongs to a first-class rerun_series record — read/link through that
// instead of the legacy rerun_series_id lineage (kept working for un-migrated
// projects). See docs/superpowers/plans/2026-08-10-rerun-update.md Task 6.
export function WaveHistory({ project }: { project: P }) {
  if (project.series_id) return <FirstClassWaveHistory project={project} seriesId={project.series_id} />
  return <LegacyWaveHistory project={project} />
}

function FirstClassWaveHistory({ project, seriesId }: { project: P; seriesId: string }) {
  const { data, isLoading, error } = useRerunSeriesRecord(seriesId)

  if (isLoading) return <p className="text-xs text-muted-foreground/50">Loading…</p>
  if (error || !data) {
    return <p className="text-xs text-destructive">Couldn&apos;t load the rerun series{error ? `: ${(error as Error).message}` : '.'}</p>
  }

  // Wave 1 anchors the series (rerun_series.origin_project_id points at it), so
  // the server refuses to remove it. Hide the control rather than offer a button
  // whose only outcome is an error.
  const isOrigin = data.series.origin_project_id === project.id

  return (
    <div className="flex flex-col gap-2 text-sm">
      <WaveSeriesView waves={data.waves} currentId={project.id} compact />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[11px] text-muted-foreground/70">Toggle Table / Timeline · click a wave to open it · colored by status.</p>
        <Link href={`/reruns/series/${seriesId}`} className="text-[12px] text-primary hover:underline shrink-0">
          ↻ Open full series record ↗
        </Link>
      </div>
      {/* Adding is offered on EVERY wave, including Wave 1 — and that is the
          point David made: he should always be able to add a wave, and only be
          blocked from removing the last one. A one-wave series previously had
          neither control, so a project promoted by mistake was stuck. Adding a
          second survey is now the way out of that. */}
      <AddWaveToSeries seriesId={seriesId} client={project.client} />

      {!isOrigin && <RemoveFromSeries project={project} />}
      {isOrigin && data.waves.length <= 1 && (
        <p className="text-[11px] text-muted-foreground/50">
          The only wave in this series can&apos;t be removed — add another survey first.
        </p>
      )}
      {isOrigin && data.waves.length > 1 && (
        <p className="text-[11px] text-muted-foreground/50">
          This is Wave 1 — the series is anchored to it, so it can&apos;t be removed. End the series
          instead.
        </p>
      )}
    </div>
  )
}

/** Add another EXISTING survey into this series.
 *
 *  The mirror of AddToSeries below: that one puts THIS survey into some other
 *  series, this one pulls another survey into THIS series. Both end up calling
 *  attach_wave; which of the two you reach for just depends on which page you
 *  happen to be looking at, so both exist. */
function AddWaveToSeries({ seriesId, client }: { seriesId: string; client: string }) {
  const [picking, setPicking] = useState(false)
  const { data: candidates = [], isLoading } = useSeriesAddCandidates(client, picking)
  const act = useRerunSeriesActions()

  function add(projectId: string, label: string) {
    act.mutate(
      { action: 'attach_wave', seriesId, projectId },
      {
        onSuccess: (res) => {
          const n = res?.attached?.length ?? 1
          toast(n > 1 ? `Added ${label} and ${n - 1} linked survey(s).` : `Added ${label}.`, 'success')
          setPicking(false)
        },
        onError: (e) => toast((e as Error).message),
      }
    )
  }

  if (!picking) {
    return (
      <button
        onClick={() => setPicking(true)}
        className="text-[12px] text-primary hover:underline self-start"
        title="Add an existing survey to this series as another wave"
      >
        ＋ Add a wave from an existing survey
      </button>
    )
  }

  const firm = client.split(' - ')[0].trim()

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-2 flex flex-col gap-1">
      <p className="text-[12px] text-muted-foreground">
        Pick a {firm} survey to add as a wave. Anything linked to it as a rerun comes too, and the
        series is renumbered by date afterwards.
      </p>
      {isLoading ? (
        <p className="text-xs text-muted-foreground/50">Loading…</p>
      ) : candidates.length === 0 ? (
        <p className="text-xs text-muted-foreground/60">
          No unassigned {firm} surveys to add — every one is already in a series.
        </p>
      ) : (
        <div className="max-h-[12rem] overflow-y-auto flex flex-col thin-scroll">
          {candidates.map((c) => (
            <button
              key={c.id}
              disabled={act.isPending}
              onClick={() => add(c.id, c.project_code ?? c.project_name)}
              className="text-left rounded px-1.5 py-1 hover:bg-accent transition-colors disabled:opacity-40"
            >
              <span className="block text-sm text-foreground truncate">
                {c.project_code ? `${c.project_code} · ` : ''}
                {c.project_name}
              </span>
              <span className="block text-[12px] text-muted-foreground truncate">
                {c.client}
                {c.submitted_date ? ` · submitted ${c.submitted_date}` : ''}
                {c.board_column ? ` · ${c.board_column}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
      <button
        onClick={() => setPicking(false)}
        className="text-[12px] text-muted-foreground hover:text-foreground self-start"
      >
        Cancel
      </button>
    </div>
  )
}

/** Take this survey out of its series. Two-step, because the wave numbers of
 *  every OTHER wave shift when one leaves, so it is not a change you want on a
 *  single mis-click. Recoverable either way — the removal is audited. */
function RemoveFromSeries({ project }: { project: P }) {
  const [confirming, setConfirming] = useState(false)
  const act = useRerunSeriesActions()

  function remove() {
    act.mutate(
      { action: 'detach_wave', projectId: project.id },
      {
        onSuccess: () => {
          toast('Removed from the series.', 'success')
          setConfirming(false)
        },
        onError: (e) => toast((e as Error).message),
      }
    )
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-[12px] text-muted-foreground hover:text-red-600 dark:hover:text-red-400 self-start transition-colors"
      >
        Remove this survey from the series
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[12px] text-muted-foreground">
        Remove it? The other waves get renumbered.
      </span>
      <button
        onClick={remove}
        disabled={act.isPending}
        className="text-[12px] px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-40"
      >
        {act.isPending ? 'Removing…' : 'Remove'}
      </button>
      <button
        onClick={() => setConfirming(false)}
        className="text-[12px] text-muted-foreground hover:text-foreground"
      >
        Cancel
      </button>
    </div>
  )
}

function LegacyWaveHistory({ project }: { project: P }) {
  const { data: waves = [], isLoading } = useRerunSeries(project.id, project.rerun_series_id)
  const [picking, setPicking] = useState(false)
  const link = useLinkRerun()
  const inSeries = waves.length > 1
  const isChild = !!project.rerun_series_id // has a root => it's a later wave, not the original

  function linkTo(parentId: string, label: string) {
    link.mutate(
      { childId: project.id, parentId },
      {
        onSuccess: () => {
          toast(`Linked as a rerun of ${label}.`, 'success')
          setPicking(false)
        },
        onError: (e) => toast((e as Error).message),
      }
    )
  }
  function unlink() {
    link.mutate(
      { childId: project.id, parentId: null },
      {
        onSuccess: () => toast('Unlinked from the series.', 'success'),
        onError: (e) => toast((e as Error).message),
      }
    )
  }

  if (isLoading) return <p className="text-xs text-muted-foreground/50">Loading…</p>

  if (!inSeries) {
    return (
      <div className="flex flex-col gap-1.5 text-sm">
        <p className="text-xs text-muted-foreground/70">Not linked to a rerun series.</p>
        {picking ? (
          <ParentPicker project={project} onPick={linkTo} onCancel={() => setPicking(false)} busy={link.isPending} />
        ) : (
          <button onClick={() => setPicking(true)} className="text-[13px] text-primary hover:underline self-start">
            ↻ Link this as a rerun of another survey
          </button>
        )}
        {/* The two options are genuinely different and the difference has bitten
            us: linking above builds an ad-hoc lineage between projects, which the
            wave list on THIS page reads. Adding to a series below sets the
            first-class series link, which is the only thing the CLIENT page
            groups on. A survey that is only linked shows up grouped here and as a
            loose row on the client's page — which is exactly how BAM's PR00388
            went unnoticed. Prefer adding to a series when one exists. */}
        {!picking && <AddToSeries project={project} />}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <WaveSeriesView waves={waves} currentId={project.id} compact />
      <p className="text-[11px] text-muted-foreground/70">
        Toggle Table / Timeline · click a wave to open it · colored by status.
      </p>
      {isChild && (
        <button
          onClick={unlink}
          disabled={link.isPending}
          className="text-[12px] text-muted-foreground hover:text-red-600 dark:hover:text-red-400 self-start disabled:opacity-40"
        >
          Unlink this wave from the series
        </button>
      )}
      {/* Reaching here means this survey has an ad-hoc lineage but NO first-class
          series link — so its waves group on this page and it renders as a loose
          row on the client page. That is the orphan state, and it is the whole
          reason this control exists: PR00010 and PR00207 are sitting in it right
          now, beside a wave 1 that IS in a series. Offering the fix here is the
          difference between the user seeing the problem and having to be told. */}
      <AddToSeries project={project} />
    </div>
  )
}

function ParentPicker({
  project,
  onPick,
  onCancel,
  busy,
}: {
  project: P
  onPick: (parentId: string, label: string) => void
  onCancel: () => void
  busy: boolean
}) {
  const { data: candidates = [], isLoading } = useRerunCandidates(project, true)
  const firm = project.client.split(' - ')[0].trim()

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-2 flex flex-col gap-1">
      <p className="text-[12px] text-muted-foreground">Pick any prior wave to link this into its full history:</p>
      {isLoading ? (
        <p className="text-xs text-muted-foreground/50">Loading…</p>
      ) : candidates.length === 0 ? (
        <p className="text-xs text-muted-foreground/60">No other {firm} surveys found to link to.</p>
      ) : (
        <div className="max-h-[12rem] overflow-y-auto flex flex-col thin-scroll">
          {candidates.map((c) => (
            <button
              key={c.id}
              disabled={busy}
              onClick={() => onPick(c.id, c.project_code ?? c.project_name)}
              className="text-left rounded px-1.5 py-1 hover:bg-accent transition-colors disabled:opacity-40"
            >
              <span className="block text-sm text-foreground truncate">
                {c.project_code ? `${c.project_code} · ` : ''}
                {c.project_name}
                {c.rerun_number && c.rerun_number > 1 ? <span className="text-[11px] text-muted-foreground font-mono"> · Wave {c.rerun_number}</span> : null}
              </span>
              <span className="block text-[12px] text-muted-foreground truncate">{c.client}</span>
            </button>
          ))}
        </div>
      )}
      <button onClick={onCancel} className="text-[12px] text-muted-foreground hover:text-foreground self-start">
        Cancel
      </button>
    </div>
  )
}

/** Put this survey into an existing rerun series.
 *
 * The operation that did not exist before: `series_id` could only be set by
 * promoting a project to Wave 1 of a NEW series, or by the auto-spawn cron. A
 * survey created by hand — or one whose link a merge had dropped — could only be
 * fixed with SQL. That is what BAM's PR00388 needed.
 *
 * Deliberately NOT the same control as "Put into rerun service", which mints a
 * brand-new series and sweeps the legacy family into it. Using that on a family
 * that already has a series creates a SECOND one and quietly re-homes the
 * siblings, which is a much worse outcome than the problem it was reached for.
 */
function AddToSeries({ project }: { project: P }) {
  const [picking, setPicking] = useState(false)
  const { data: allSeries = [], isLoading } = useRerunSeriesList()
  const act = useRerunSeriesActions()

  // Same firm-matching rule the wave picker above uses: the client string is
  // "Firm - Contact", and a series belongs to the firm, not the contact.
  const firm = project.client.split(' - ')[0].trim().toLowerCase()
  const candidates = allSeries.filter(
    (s) => (s.client ?? '').split(' - ')[0].trim().toLowerCase() === firm
  )

  function attach(seriesId: string, label: string) {
    act.mutate(
      { action: 'attach_wave', seriesId, projectId: project.id },
      {
        onSuccess: (res) => {
          // Report how many surveys actually moved, not just this one. Attaching
          // sweeps the whole legacy lineage family, so a Holocene week-1 survey
          // takes thirteen siblings with it — saying "Added to X" there would
          // understate the action by an order of magnitude.
          const n = res?.attached?.length ?? 1
          toast(n > 1 ? `Added ${n} linked surveys to ${label}.` : `Added to ${label}.`, 'success')
          setPicking(false)
        },
        onError: (e) => toast((e as Error).message),
      }
    )
  }

  if (!picking) {
    return (
      <button
        onClick={() => setPicking(true)}
        className="text-[13px] text-primary hover:underline self-start"
        title="Add this survey to an existing rerun series, so it groups with the other waves on the client page"
      >
        ＋ Add this survey to an existing series
      </button>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-2 flex flex-col gap-1">
      <p className="text-[12px] text-muted-foreground">
        Add this survey as a wave of an existing series. Any surveys linked to it as reruns come
        too, and the series is renumbered by date afterwards.
      </p>
      {isLoading ? (
        <p className="text-xs text-muted-foreground/50">Loading…</p>
      ) : candidates.length === 0 ? (
        <p className="text-xs text-muted-foreground/60">
          No existing series for {project.client.split(' - ')[0].trim()}. Use “Put into rerun
          service” on the first wave to start one.
        </p>
      ) : (
        <div className="max-h-[12rem] overflow-y-auto flex flex-col thin-scroll">
          {candidates.map((s) => (
            <button
              key={s.id}
              disabled={act.isPending}
              onClick={() => attach(s.id, s.survey_name ?? 'the series')}
              className="text-left rounded px-1.5 py-1 hover:bg-accent transition-colors disabled:opacity-40"
            >
              <span className="block text-sm text-foreground truncate">{s.survey_name}</span>
              <span className="block text-[12px] text-muted-foreground truncate">
                {s.client}
                {typeof s.wave_count === 'number' ? ` · ${s.wave_count} wave${s.wave_count === 1 ? '' : 's'}` : ''}
                {s.delivery_cadence ? ` · ${s.delivery_cadence}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
      <button
        onClick={() => setPicking(false)}
        className="text-[12px] text-muted-foreground hover:text-foreground self-start"
      >
        Cancel
      </button>
    </div>
  )
}
