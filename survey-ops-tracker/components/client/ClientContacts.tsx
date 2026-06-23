'use client'
import { useState } from 'react'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import {
  useClientContacts,
  useCreateClientContact,
  useUpdateClientContact,
  useArchiveClientContact,
  useDeleteClientContact,
} from '@/lib/hooks/useClientContacts'
import { contactName, contactSubtitle } from '@/lib/utils/contact'
import {
  ContactForm,
  contactToDraft,
  draftToFields,
  emptyDraft,
  type ContactDraft,
} from '@/components/client/ContactForm'

export function ClientContacts({ clientId }: { clientId: string }) {
  const { data: contacts = [], isLoading } = useClientContacts(clientId)
  const create = useCreateClientContact(clientId)
  const update = useUpdateClientContact(clientId)
  const archive = useArchiveClientContact(clientId)
  const del = useDeleteClientContact(clientId)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const active = contacts.filter(c => !c.archived)
  const archived = contacts.filter(c => c.archived)

  function handleCreate(d: ContactDraft) {
    create.mutate(draftToFields(d), { onSuccess: () => setAdding(false) })
  }
  function handleEdit(id: string, d: ContactDraft) {
    update.mutate({ id, updates: draftToFields(d) }, { onSuccess: () => setEditingId(null) })
  }

  return (
    <div className="bg-card border border-border shadow-sm rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs text-muted-foreground uppercase tracking-widest font-medium flex items-center">
          Contacts
          <InfoTooltip text="People at this client. Pick one as a project's 'Requested by'. Deleting a contact archives it (it leaves the picker but stays on past projects); permanent delete lives under Archived." />
        </h3>
        {!adding && (
          <button onClick={() => setAdding(true)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
            + Add contact
          </button>
        )}
      </div>

      {adding && (
        <ContactForm
          initial={emptyDraft()}
          submitLabel="Add"
          busy={create.isPending}
          onSubmit={handleCreate}
          onCancel={() => setAdding(false)}
        />
      )}

      {isLoading ? (
        <p className="text-xs text-muted-foreground/60">Loading…</p>
      ) : active.length === 0 && !adding ? (
        <p className="text-xs text-muted-foreground/60">No contacts yet — add the person who requests this client&apos;s surveys.</p>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {active.map(c =>
            editingId === c.id ? (
              <div key={c.id} className="py-2">
                <ContactForm
                  initial={contactToDraft(c)}
                  submitLabel="Save"
                  busy={update.isPending}
                  onSubmit={d => handleEdit(c.id, d)}
                  onCancel={() => setEditingId(null)}
                />
              </div>
            ) : (
              <div key={c.id} className="flex items-center justify-between gap-2 py-2 group">
                <div className="min-w-0">
                  <p className="text-sm text-foreground truncate">{contactName(c)}</p>
                  {contactSubtitle(c) && <p className="text-xs text-muted-foreground truncate">{contactSubtitle(c)}</p>}
                  {c.phone && <p className="text-xs text-muted-foreground truncate">{c.phone}</p>}
                </div>
                <div className="flex items-center gap-2 text-xs shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => setEditingId(c.id)} className="text-blue-600 dark:text-blue-400 hover:underline">
                    Edit
                  </button>
                  <button
                    onClick={() => archive.mutate({ id: c.id, archived: true })}
                    className="text-muted-foreground hover:text-foreground"
                    title="Archive — removes from the picker, keeps it on past projects"
                  >
                    Archive
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      )}

      {archived.length > 0 && (
        <div className="border-t border-border pt-2">
          <button onClick={() => setShowArchived(s => !s)} className="text-xs text-muted-foreground hover:text-foreground">
            {showArchived ? 'Hide' : 'Show'} archived ({archived.length})
          </button>
          {showArchived && (
            <div className="flex flex-col divide-y divide-border mt-1">
              {archived.map(c => (
                <div key={c.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-muted-foreground truncate">{contactName(c)}</p>
                    {contactSubtitle(c) && (
                      <p className="text-xs text-muted-foreground/70 truncate">{contactSubtitle(c)}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs shrink-0">
                    <button
                      onClick={() => archive.mutate({ id: c.id, archived: false })}
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Restore
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`Permanently delete ${contactName(c)}? Past projects keep the name for history.`))
                          del.mutate(c.id)
                      }}
                      className="text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
