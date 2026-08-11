'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRerunSeriesActions } from '@/lib/hooks/useRerunSeriesRecord'
import { effectiveNext } from '@/lib/reruns/series'
import { formatDate } from '@/lib/utils/date'
import { toast } from '@/lib/utils/toast'

// "Put into rerun service" — the entry point that promotes an existing
// project to Wave 1 of a brand-new first-class rerun_series (migration 073).
// Reuses the CloneProjectModal dialog pattern. See docs/superpowers/specs/
// 2026-08-10-rerun-update-design.md §11 and docs/superpowers/plans/2026-08-10-
// rerun-update.md Task 6 + the review-hardening addendum.

const CADENCE_OPTS: { v: string; label: string }[] = [
  { v: '', label: 'Ad-hoc / one-off' },
  { v: '1', label: 'Monthly' },
  { v: '3', label: 'Quarterly' },
  { v: '6', label: 'Every 6 mo' },
  { v: '12', label: 'Yearly' },
]

type PromotableProject = {
  id: string
  project_name: string
  project_code: string | null
  project_type: string | null
  client: string
  rerun_date: string | null
  launch_date: string | null
}

export function PutIntoRerunServiceModal({ project, onClose }: { project: PromotableProject; onClose: () => void }) {
  const router = useRouter()
  const actions = useRerunSeriesActions()
  const [cadence, setCadence] = useState('1')
  const [serviceMode, setServiceMode] = useState<'auto' | 'manual'>('auto')
  const [baseType, setBaseType] = useState<'PS' | 'B2B' | ''>(
    project.project_type === 'PS' || project.project_type === 'B2B' ? project.project_type : ''
  )
  const [nTarget, setNTarget] = useState('')
  const [audience, setAudience] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [complianceOverride, setComplianceOverride] = useState(false)

  const baseTypeRequired = project.project_type !== 'PS' && project.project_type !== 'B2B'
  const canSubmit = baseType === 'PS' || baseType === 'B2B'

  const preview = effectiveNext({
    lastOn: project.launch_date ?? project.rerun_date ?? null,
    anchorDate: null,
    resumeAnchor: null,
    cadenceMonths: cadence ? Number(cadence) : null,
    paused: false,
    inService: true,
  })

  function submit() {
    if (!canSubmit) return
    actions.mutate(
      {
        action: 'create',
        projectId: project.id,
        base_type: baseType as 'PS' | 'B2B',
        cadence_months: cadence ? Number(cadence) : null,
        service_mode: serviceMode,
        future_defaults: {
          n_target: nTarget ? Number(nTarget) : null,
          audience: audience.trim() || null,
          template_id: templateId.trim() || null,
          compliance_required_override: complianceOverride ? true : null,
        },
      },
      {
        onSuccess: (data) => {
          toast(`Put into rerun service — ${project.project_code ?? project.project_name} is now Wave 1.`, 'success')
          onClose()
          if (data.series?.id) router.push(`/reruns/series/${data.series.id}`)
        },
        onError: (e) => toast((e as Error).message),
      }
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl shadow-lg w-full max-w-lg p-4 flex flex-col gap-3 max-h-[90vh] overflow-y-auto thin-scroll"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-sm font-semibold text-foreground">Put into rerun service</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {project.project_code ? `${project.project_code} · ` : ''}
            {project.project_name} becomes <span className="text-foreground">Wave 1</span> of a new rerun series. Future
            waves inherit the cadence and defaults below; this project itself is never edited by the promotion.
          </p>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-muted-foreground">Cadence</span>
            <select
              value={cadence}
              onChange={(e) => setCadence(e.target.value)}
              className="bg-muted border border-border text-foreground text-sm rounded-md px-2 py-1.5 focus:outline-none focus:border-ring"
            >
              {CADENCE_OPTS.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-muted-foreground">
              Base type{baseTypeRequired && <span className="text-red-500"> *</span>}
            </span>
            <select
              value={baseType}
              onChange={(e) => setBaseType(e.target.value as 'PS' | 'B2B' | '')}
              className="bg-muted border border-border text-foreground text-sm rounded-md px-2 py-1.5 focus:outline-none focus:border-ring"
            >
              <option value="" disabled>
                Choose…
              </option>
              <option value="PS">PS</option>
              <option value="B2B">B2B</option>
            </select>
          </label>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] text-muted-foreground">Wave creation</span>
          <div className="inline-flex rounded-lg border border-border overflow-hidden w-fit" role="group" aria-label="Auto or manual">
            <button
              type="button"
              onClick={() => setServiceMode('auto')}
              aria-pressed={serviceMode === 'auto'}
              className={`px-3 py-1.5 text-sm transition-colors ${serviceMode === 'auto' ? 'bg-primary/15 text-primary font-medium' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Auto
            </button>
            <span className="w-px bg-border" />
            <button
              type="button"
              onClick={() => setServiceMode('manual')}
              aria-pressed={serviceMode === 'manual'}
              className={`px-3 py-1.5 text-sm transition-colors ${serviceMode === 'manual' ? 'bg-primary/15 text-primary font-medium' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Manual
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground/80">
            {serviceMode === 'auto'
              ? 'Auto = the next wave is created for you before it’s due.'
              : 'Manual = you press "Create next wave" yourself, on your own schedule.'}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-muted/40 p-2.5 text-xs">
          {preview ? (
            <p className="text-foreground">
              First auto-wave preview: <span className="font-medium">~{formatDate(preview)}</span>
            </p>
          ) : cadence === '' ? (
            <p className="text-muted-foreground">Ad-hoc — no automatic schedule. Use “Create next wave” manually when it&apos;s time.</p>
          ) : (
            <p className="text-muted-foreground">
              Can&apos;t compute a preview yet — this project has no launch/rerun date set. The first wave can still be
              created manually.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-border p-3 flex flex-col gap-2.5">
          <p className="text-[12px] text-muted-foreground">
            <span className="text-foreground font-medium">Defaults for future waves</span> — this project stays as Wave 1;
            these apply to Wave 2 onward.
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-2">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-muted-foreground">N target</span>
              <input
                type="number"
                min={0}
                value={nTarget}
                onChange={(e) => setNTarget(e.target.value)}
                className="bg-muted border border-border text-foreground text-sm rounded-md px-2 py-1.5 w-24 focus:outline-none focus:border-ring"
              />
            </label>
            <label className="flex flex-col gap-1 flex-1 min-w-[10rem]">
              <span className="text-[12px] text-muted-foreground">Audience</span>
              <input
                type="text"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                className="bg-muted border border-border text-foreground text-sm rounded-md px-2 py-1.5 focus:outline-none focus:border-ring"
              />
            </label>
            <label className="flex flex-col gap-1 flex-1 min-w-[8rem]">
              <span className="text-[12px] text-muted-foreground">Template</span>
              <input
                type="text"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                className="bg-muted border border-border text-foreground text-sm rounded-md px-2 py-1.5 focus:outline-none focus:border-ring"
              />
            </label>
          </div>
          <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <input type="checkbox" checked={complianceOverride} onChange={(e) => setComplianceOverride(e.target.checked)} />
            Require compliance review on every future wave (waves ≥ 2 are waived by default)
          </label>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={submit}
            disabled={!canSubmit || actions.isPending}
            title={!canSubmit ? 'Choose a base type first.' : undefined}
            className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
          >
            {actions.isPending ? 'Putting into service…' : 'Put into rerun service'}
          </button>
          <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
