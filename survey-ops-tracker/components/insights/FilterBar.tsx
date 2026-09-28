'use client'

import Link from 'next/link'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { fmtNum } from '@/lib/utils/number'
import { RANGE_PRESETS, resolveRange, type RangePreset } from '@/lib/insights/range'
import { DEFAULT_FILTER, insightsHref, isFiltered, type InsightsFilter, type TypeKey } from '@/lib/insights/filters'
import type { InsightsModel, OptionRow } from '@/lib/insights/model'

/**
 * The filters, all in the URL. The date presets are real links (so a preset
 * can be opened in a new tab or sent to someone); the three pickers replace
 * the URL in place, so Back is not a history of every tweak.
 */
export function FilterBar({ model, onChange }: {
  model: InsightsModel
  onChange: (next: InsightsFilter) => void
}) {
  const f = model.filter
  const r = resolveRange(f.range, model.today)
  const presetHref = (preset: RangePreset) =>
    insightsHref(f, {
      range: preset === 'custom'
        // Opening Custom starts from the range on screen, so the two date
        // boxes are filled in rather than blank.
        ? { preset, from: r.from ?? model.today.slice(0, 8) + '01', to: r.to ?? model.today }
        : { preset, from: null, to: null },
    })
  const pick = PICK
  const label = LABEL

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Date range">
        <span className={`${label} mr-1`}>
          Dates
          <InfoTooltip text="Which delivered surveys to count. A survey is placed by its deliver date — the day the client had it. Work in flight right now is shown whatever the dates." />
        </span>
        {RANGE_PRESETS.map(p => {
          const on = f.range.preset === p.id
          return (
            <Link
              key={p.id}
              href={presetHref(p.id)}
              replace
              scroll={false}
              title={p.help}
              aria-current={on ? 'true' : undefined}
              className={
                'rounded-full border px-2.5 py-1 text-xs transition-colors ' +
                (on
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:border-ring hover:text-foreground')
              }
            >
              {p.label}
            </Link>
          )
        })}
        {f.range.preset === 'custom' && (
          <span className="flex flex-wrap items-center gap-1.5">
            <input
              type="date"
              aria-label="From (inclusive)"
              title="First deliver date to count (inclusive)"
              className={pick}
              value={f.range.from ?? ''}
              max={f.range.to ?? undefined}
              onChange={e => onChange({ ...f, range: { preset: 'custom', from: e.target.value || null, to: f.range.to } })}
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              aria-label="To (inclusive)"
              title="Last deliver date to count (inclusive)"
              className={pick}
              value={f.range.to ?? ''}
              min={f.range.from ?? undefined}
              onChange={e => onChange({ ...f, range: { preset: 'custom', from: f.range.from, to: e.target.value || null } })}
            />
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Picker
          id="insights-type"
          label="Type"
          help="What the survey mainly is: PS (PureSpectrum panel) or B2B (email / text blasts). The number beside each is how many were delivered in the dates above."
          value={f.type ?? ''}
          all="All types"
          options={model.options.types}
          onChange={v => onChange({ ...f, type: (v || null) as TypeKey | null })}
        />
        <Picker
          id="insights-captain"
          label="Captain"
          help="The survey's lead captain. Co-captains are not counted, so every survey belongs to exactly one person. The number beside each is how many they delivered in the dates above."
          value={f.captain ?? ''}
          all="Everyone"
          options={model.options.captains}
          onChange={v => onChange({ ...f, captain: v || null })}
        />
        <Picker
          id="insights-account"
          label="Account"
          help="The client account (grouped by the account record, not the free-text client label). The number beside each is how many surveys it received in the dates above."
          value={f.account ?? ''}
          all="Every account"
          options={model.options.accounts}
          onChange={v => onChange({ ...f, account: v || null })}
          wide
        />
        {isFiltered(f) && (
          <Link
            href={insightsHref(DEFAULT_FILTER)}
            replace
            scroll={false}
            className="h-8 self-end rounded-md px-2 py-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            title="Back to this month, every type, captain and account"
          >
            Clear filters
          </Link>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Showing <span className="font-medium text-foreground">{model.rangeLabel}</span>
        {model.prevLabel
          ? <> · compared with <span className="text-foreground">{model.prevLabel}</span>, the same span just before</>
          : <> · no earlier period to compare with</>}
        {model.filterWords.length > 0 && <> · {model.filterWords.join(' · ')}</>}
      </p>
    </div>
  )
}

const PICK = 'h-8 min-w-0 rounded-md border border-border bg-background px-2 text-sm text-foreground'
const LABEL = 'flex items-center text-xs text-muted-foreground'

/** One labelled picker. The (i) sits beside the label, not inside it, so
 *  clicking the explainer does not open the list. */
function Picker({ id, label, help, value, all, options, onChange, wide }: {
  id: string
  label: string
  help: string
  value: string
  all: string
  options: OptionRow[]
  onChange: (v: string) => void
  wide?: boolean
}) {
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-1">
      <span className={LABEL}>
        <label htmlFor={id}>{label}</label>
        <InfoTooltip text={help} />
      </span>
      <select id={id} className={`${PICK}${wide ? ' max-w-[16rem]' : ''}`} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">{all}</option>
        {options.map(o => (
          <option key={o.id} value={o.id} title={o.help}>{o.label} ({fmtNum(o.count)})</option>
        ))}
      </select>
    </div>
  )
}
