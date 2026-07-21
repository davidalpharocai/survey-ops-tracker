'use client'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { useClients } from '@/lib/hooks/useClients'
import { useTeamMembers, assignableMembers } from '@/lib/hooks/useTeamMembers'
import { useCurrentMember } from '@/lib/hooks/useCurrentMember'
import {
  EVENT_TYPES,
  EVENT_TYPE_META,
  type CalendarEventType,
  type CalendarFilterState,
} from '@/lib/calendar/events'

const SELECT_CLASSES =
  'bg-muted border border-border text-foreground/80 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-ring'

function Field({
  label,
  tooltip,
  children,
}: {
  label: string
  tooltip?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="flex items-center text-[12px] text-muted-foreground uppercase tracking-wider">
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </span>
      {children}
    </label>
  )
}

/** A pill toggle mirroring the "Mine" button style used on the Reruns page. */
function Toggle({
  active,
  onClick,
  title,
  children,
  'aria-label': ariaLabel,
}: {
  active: boolean
  onClick: () => void
  title?: string
  children: React.ReactNode
  'aria-label'?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      title={title}
      className={`text-xs rounded-lg px-2.5 py-1.5 border transition-colors ${
        active
          ? 'bg-primary/15 text-primary border-primary/40'
          : 'bg-muted text-muted-foreground border-border hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

interface CalendarFiltersProps {
  filters: CalendarFilterState
  onChange: (next: CalendarFilterState) => void
}

export function CalendarFilters({ filters, onChange }: CalendarFiltersProps) {
  const { data: clients = [] } = useClients()
  const { data: members = [] } = useTeamMembers()
  const { data: me } = useCurrentMember()
  const captains = assignableMembers(members)

  const patch = (p: Partial<CalendarFilterState>) => onChange({ ...filters, ...p })
  const toggleType = (t: CalendarEventType) =>
    patch({ types: { ...filters.types, [t]: !filters.types[t] } })
  const scope = filters.statusScope

  return (
    <div className="flex flex-col gap-3">
      {/* Legend — doubles as the event-type on/off toggles. */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="flex items-center text-[12px] text-muted-foreground uppercase tracking-wider">
          Show
          <InfoTooltip text="Color legend + on/off toggles. Click a type to hide it from the calendar. Reminders are your own personal reminders." />
        </span>
        {EVENT_TYPES.map(t => {
          const meta = EVENT_TYPE_META[t]
          const on = filters.types[t]
          return (
            <button
              key={t}
              type="button"
              onClick={() => toggleType(t)}
              aria-pressed={on}
              title={meta.tip}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                on
                  ? 'border-border bg-card text-foreground'
                  : 'border-border/60 bg-muted text-muted-foreground line-through opacity-60'
              }`}
            >
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${on ? meta.dot : 'bg-muted-foreground/40'}`}
                aria-hidden="true"
              />
              {meta.short}
            </button>
          )
        })}
      </div>

      {/* Filters. */}
      <div className="flex items-end gap-3 flex-wrap">
        <Field label="Captain" tooltip="Show only projects led (or co-captained) by this team member.">
          <select
            value={filters.captainId ?? ''}
            onChange={e => patch({ captainId: e.target.value || null })}
            className={SELECT_CLASSES}
          >
            <option value="">All captains</option>
            {captains.map(c => (
              <option key={c.id} value={c.id}>
                {c.id === me?.id ? `${c.initials} (me)` : c.initials}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Type" tooltip="Project type: PS (PureSpectrum consumer panel), B2B (expert/business panel), or Rerun. Lets Sree isolate reruns.">
          <select
            value={filters.projectType ?? ''}
            onChange={e =>
              patch({ projectType: (e.target.value || null) as CalendarFilterState['projectType'] })
            }
            className={SELECT_CLASSES}
          >
            <option value="">All types</option>
            <option value="PS">PS</option>
            <option value="B2B">B2B</option>
            <option value="Rerun">Rerun</option>
          </select>
        </Field>

        <Field label="Client" tooltip="Focus one client's deadlines (matches on the firm name).">
          <select
            value={filters.client ?? ''}
            onChange={e => patch({ client: e.target.value || null })}
            className={SELECT_CLASSES}
          >
            <option value="">All clients</option>
            {clients.map(c => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Status scope"
          tooltip="Default shows open work only (status Open + Active phase). Turn these on to also include paused, finished, or pre-sale (Scoping) projects."
        >
          <div className="flex items-center gap-1.5">
            <Toggle
              active={scope.includeHold}
              onClick={() => patch({ statusScope: { ...scope, includeHold: !scope.includeHold } })}
              title="Also include On-Hold (paused) projects"
            >
              On-Hold
            </Toggle>
            <Toggle
              active={scope.includeClosed}
              onClick={() =>
                patch({ statusScope: { ...scope, includeClosed: !scope.includeClosed } })
              }
              title="Also include Closed (finished) projects"
            >
              Closed
            </Toggle>
            <Toggle
              active={scope.includeScoping}
              onClick={() =>
                patch({ statusScope: { ...scope, includeScoping: !scope.includeScoping } })
              }
              title="Also include pre-sale Scoping projects"
            >
              Scoping
            </Toggle>
          </div>
        </Field>

        <Field label="Quick" tooltip="Just mine = only projects you captain. Priority = high/urgent projects only.">
          <div className="flex items-center gap-1.5">
            {me?.id && (
              <Toggle
                active={filters.justMine}
                onClick={() => patch({ justMine: !filters.justMine })}
                title="Show only projects I captain"
              >
                👤 Just mine
              </Toggle>
            )}
            <Toggle
              active={filters.priorityOnly}
              onClick={() => patch({ priorityOnly: !filters.priorityOnly })}
              title="Show only high / urgent priority projects"
            >
              ⚑ Priority
            </Toggle>
          </div>
        </Field>
      </div>
    </div>
  )
}
