'use client'
import { useState } from 'react'
import {
  useTeamMembers,
  useAddTeamMember,
  useUpdateTeamMember,
  suggestInitials,
  type TeamMember,
} from '@/lib/hooks/useTeamMembers'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { toast } from '@/lib/utils/toast'

const tile = 'bg-card border border-border shadow-sm rounded-xl p-4'
const heading = 'text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium flex items-center'
const inputCls =
  'bg-muted border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-ring'

export function TeamRoster() {
  const { data: members = [] } = useTeamMembers()
  const add = useAddTeamMember()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <div className={tile}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className={`${heading} mb-0`}>
          Team roster
          <InfoTooltip text="Everyone the tracker knows — this is the list of people who can be set as a project captain. Add a teammate here to make them selectable. Members marked (former employee) stay for history but can't be assigned. Logins are still managed separately in Supabase — Users." />
        </h3>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            title="Add a teammate to the roster so they can be assigned as a project captain."
            className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg transition-colors shrink-0"
          >
            + Add member
          </button>
        )}
      </div>

      {adding && <AddMemberForm onDone={() => setAdding(false)} add={add} />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 max-h-[16rem] overflow-y-auto thin-scroll pr-1">
        {members.map((m) =>
          editingId === m.id ? (
            <EditMemberRow key={m.id} member={m} onDone={() => setEditingId(null)} />
          ) : (
            <div
              key={m.id}
              className="flex items-center justify-between gap-2 py-1 border-b border-border/40 last:border-0 group"
            >
              <span className="text-sm text-foreground truncate">
                <span className="text-xs font-mono text-muted-foreground mr-2">{m.initials}</span>
                {m.name}
              </span>
              <span className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-muted-foreground">{m.email}</span>
                <button
                  onClick={() => setEditingId(m.id)}
                  title="Edit name / initials"
                  className="text-xs text-muted-foreground/60 hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ✎
                </button>
              </span>
            </div>
          )
        )}
      </div>
    </div>
  )
}

function AddMemberForm({ onDone, add }: { onDone: () => void; add: ReturnType<typeof useAddTeamMember> }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [initials, setInitials] = useState('')
  const [initialsTouched, setInitialsTouched] = useState(false)

  function onName(v: string) {
    setName(v)
    if (!initialsTouched) setInitials(suggestInitials(v))
  }
  function submit() {
    add.mutate(
      { name: name.trim(), email: email.trim(), initials },
      {
        onSuccess: (m) => {
          toast(`Added ${m.name} — now selectable as a captain.`, 'success')
          onDone()
        },
        onError: (e) => toast((e as Error).message),
      }
    )
  }

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3 mb-3 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2 items-center">
        <input
          autoFocus
          placeholder="Full name"
          value={name}
          onChange={(e) => onName(e.target.value)}
          className={`${inputCls} flex-1 min-w-[9rem]`}
        />
        <input
          inputMode="email"
          placeholder="name@alpharoc.ai"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`${inputCls} flex-1 min-w-[10rem]`}
        />
        <input
          placeholder="Initials"
          value={initials}
          onChange={(e) => {
            setInitials(e.target.value.toUpperCase())
            setInitialsTouched(true)
          }}
          className={`${inputCls} w-20`}
          title="Shown on cards and synced to the sheet's captain column (e.g. DS)."
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={submit}
          disabled={add.isPending}
          className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
        >
          {add.isPending ? 'Adding…' : 'Add member'}
        </button>
        <button onClick={onDone} className="text-xs text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>
    </div>
  )
}

function EditMemberRow({ member, onDone }: { member: TeamMember; onDone: () => void }) {
  const update = useUpdateTeamMember()
  const [name, setName] = useState(member.name)
  const [initials, setInitials] = useState(member.initials ?? '')

  function save() {
    update.mutate(
      { id: member.id, name: name.trim(), initials },
      {
        onSuccess: () => {
          toast('Saved ✓', 'success')
          onDone()
        },
        onError: (e) => toast((e as Error).message),
      }
    )
  }

  return (
    <div className="flex items-center gap-1.5 py-1 border-b border-border/40 last:border-0">
      <input
        value={initials}
        onChange={(e) => setInitials(e.target.value.toUpperCase())}
        className={`${inputCls} w-14`}
        title="Initials"
      />
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={`${inputCls} flex-1 min-w-0`}
        title="Display name"
      />
      <button
        onClick={save}
        disabled={update.isPending}
        className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded transition-colors disabled:opacity-40 shrink-0"
      >
        Save
      </button>
      <button onClick={onDone} className="text-xs text-muted-foreground hover:text-foreground px-1 shrink-0">
        ✕
      </button>
    </div>
  )
}
