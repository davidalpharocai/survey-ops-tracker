'use client'
import { useState } from 'react'
import Link from 'next/link'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import {
  useClientContacts,
  useCreateClientContact,
  useUpdateClientContact,
  type ClientContact,
} from '@/lib/hooks/useClientContacts'
import { useProjectsByContact } from '@/lib/hooks/useProjectsByContact'
import { contactName, contactSubtitle } from '@/lib/utils/contact'
import {
  ContactForm,
  contactToDraft,
  draftToFields,
  emptyDraft,
  type ContactDraft,
} from '@/components/client/ContactForm'

type Props = {
  clientId: string
  contactId: string | null
  snapshotName: string | null
  tooltip?: string
  onChange: (next: { requested_by_contact_id: string | null; requested_by_name: string | null }) => void
}

type Mode = 'closed' | 'details' | 'pick' | 'new' | 'edit'

export function RequestedByRow({ clientId, contactId, snapshotName, tooltip, onChange }: Props) {
  const [mode, setMode] = useState<Mode>('closed')
  const { data: contacts = [] } = useClientContacts(clientId)
  const create = useCreateClientContact(clientId)
  const update = useUpdateClientContact(clientId)

  const current = contactId ? contacts.find(c => c.id === contactId) ?? null : null
  const { data: contactProjects = [] } = useProjectsByContact(current ? current.id : null)
  const active = contacts.filter(c => !c.archived)
  // Show the live contact's name if it still exists, else the saved snapshot.
  const label = current ? contactName(current) : snapshotName

  function select(c: ClientContact) {
    onChange({ requested_by_contact_id: c.id, requested_by_name: contactName(c) })
    setMode('closed')
  }
  function clear() {
    onChange({ requested_by_contact_id: null, requested_by_name: null })
    setMode('closed')
  }
  function handleCreate(d: ContactDraft) {
    create.mutate(draftToFields(d), { onSuccess: c => select(c) })
  }
  function handleEdit(d: ContactDraft) {
    if (!current) return
    const fields = draftToFields(d)
    update.mutate(
      { id: current.id, updates: fields },
      {
        onSuccess: () => {
          // Keep the project's snapshot name in sync with the edited contact.
          onChange({ requested_by_contact_id: current.id, requested_by_name: contactName(fields) })
          setMode('details')
        },
      }
    )
  }

  return (
    <div className="flex justify-between items-start text-sm gap-2 relative">
      <span className="text-muted-foreground flex items-center text-xs shrink-0 mt-0.5">
        Requested by
        {tooltip && <InfoTooltip text={tooltip} />}
      </span>
      <button
        onClick={() => (mode === 'closed' ? setMode(current ? 'details' : 'pick') : setMode('closed'))}
        className="text-sm text-right truncate text-primary hover:underline"
        title="View, edit, or change the requester"
      >
        {label ?? <span className="text-muted-foreground/50">— click to set</span>}
      </button>

      {mode !== 'closed' && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMode('closed')} aria-hidden="true" />
          <div className="absolute right-0 top-full mt-1 z-20 w-64 bg-card border border-border rounded-lg shadow-lg p-2 text-left">
            {mode === 'details' && current && (
              <div className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{contactName(current)}</p>
                    {current.title && <p className="text-xs text-muted-foreground">{current.title}</p>}
                    {current.email && (
                      <a
                        href={`mailto:${current.email}`}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline block truncate"
                      >
                        {current.email}
                      </a>
                    )}
                    {current.phone && <p className="text-xs text-muted-foreground">{current.phone}</p>}
                    {current.archived && (
                      <p className="text-[12px] text-amber-600 dark:text-amber-400 mt-1">Archived contact</p>
                    )}
                  </div>
                  <Link
                    href={`/list?contact=${current.id}&contactName=${encodeURIComponent(contactName(current))}&view=full`}
                    className="text-muted-foreground hover:text-primary text-sm shrink-0 mt-0.5"
                    title={`See all projects requested by ${contactName(current)} in the list`}
                  >
                    ↗
                  </Link>
                </div>

                <div className="border-t border-border pt-2">
                  <p className="text-[12px] text-muted-foreground pb-1">
                    Projects{contactProjects.length > 0 ? ` (${contactProjects.length})` : ''}
                  </p>
                  {contactProjects.length === 0 ? (
                    <p className="text-xs text-muted-foreground/60">No projects for this contact.</p>
                  ) : (
                    <div className="flex flex-col max-h-32 overflow-y-auto gap-1">
                      {contactProjects.map(p => (
                        <Link
                          key={p.id}
                          href={`/projects/${p.id}`}
                          className="text-xs text-primary hover:underline truncate"
                          title={p.project_name}
                        >
                          {p.project_code ? `${p.project_code} · ` : ''}
                          {p.project_name}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 border-t border-border pt-2 text-xs">
                  <button onClick={() => setMode('edit')} className="text-blue-600 dark:text-blue-400 hover:underline">
                    Edit
                  </button>
                  <button onClick={() => setMode('pick')} className="text-blue-600 dark:text-blue-400 hover:underline">
                    Change
                  </button>
                  <button onClick={clear} className="text-muted-foreground hover:text-red-600 dark:hover:text-red-400 ml-auto">
                    Clear
                  </button>
                </div>
              </div>
            )}

            {mode === 'pick' && (
              <div className="flex flex-col">
                <p className="text-[12px] text-muted-foreground px-1 pb-1">Pick a contact</p>
                <div className="max-h-[12rem] overflow-y-auto">
                  {active.length === 0 && (
                    <p className="text-xs text-muted-foreground/60 px-1 py-2">No contacts yet.</p>
                  )}
                  {active.map(c => (
                    <button
                      key={c.id}
                      onClick={() => select(c)}
                      className={`w-full text-left rounded px-2 py-1.5 hover:bg-accent transition-colors ${
                        c.id === contactId ? 'bg-accent' : ''
                      }`}
                    >
                      <span className="block text-sm text-foreground truncate">{contactName(c)}</span>
                      {contactSubtitle(c) && (
                        <span className="block text-[12px] text-muted-foreground truncate">{contactSubtitle(c)}</span>
                      )}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setMode('new')}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline text-left px-2 py-1.5 border-t border-border mt-1"
                >
                  + New contact
                </button>
              </div>
            )}

            {mode === 'new' && (
              <ContactForm
                initial={emptyDraft()}
                submitLabel="Add"
                busy={create.isPending}
                onSubmit={handleCreate}
                onCancel={() => setMode(current ? 'details' : 'pick')}
              />
            )}

            {mode === 'edit' && current && (
              <ContactForm
                initial={contactToDraft(current)}
                submitLabel="Save"
                busy={update.isPending}
                onSubmit={handleEdit}
                onCancel={() => setMode('details')}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}
