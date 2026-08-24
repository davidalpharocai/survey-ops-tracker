'use client'
import { useState } from 'react'
import Link from 'next/link'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import {
  useClientContacts,
  useCreateClientContact,
  useUpdateClientContact,
  useArchiveClientContact,
  useDeleteClientContact,
} from '@/lib/hooks/useClientContacts'
import { useCurrentMember } from '@/lib/hooks/useCurrentMember'
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
  const { data: currentMember } = useCurrentMember()
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
  // Occam onboarding flag. Marking it lets a first delivery to this contact skip the
  // delivery-time prompt (they've already got their Occam invite); clearing it re-arms.
  function toggleOccam(id: string, invited: boolean) {
    update.mutate({
      id,
      updates: invited
        ? { occam_invited: false, occam_invited_at: null, occam_invited_by: null }
        : { occam_invited: true, occam_invited_at: new Date().toISOString(), occam_invited_by: currentMember?.name ?? null },
    })
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
                  <p className="text-sm text-foreground truncate flex items-center gap-1.5">
                    {/* The name is the way into the contact's own page (every survey
                        they asked for). It covers the name only — the Occam badge and
                        the hover actions to the right stay their own click targets. */}
                    <Link
                      href={`/contacts/${c.id}`}
                      className="truncate text-primary hover:underline"
                      title={`Open ${contactName(c)}'s page — every survey they requested`}
                    >
                      {contactName(c)}
                    </Link>
                    {c.occam_invited && (
                      <span
                        className="shrink-0 text-[10px] leading-none px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20"
                        title={`Invited to Occam${c.occam_invited_at ? ` on ${String(c.occam_invited_at).slice(0, 10)}` : ''}${c.occam_invited_by ? ` by ${c.occam_invited_by}` : ''}`}
                      >
                        Occam ✓
                      </span>
                    )}
                  </p>
                  {contactSubtitle(c) && <p className="text-xs text-muted-foreground truncate">{contactSubtitle(c)}</p>}
                  {c.phone && <p className="text-xs text-muted-foreground truncate">{c.phone}</p>}
                </div>
                <div className="flex items-center gap-2 text-xs shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => toggleOccam(c.id, c.occam_invited)}
                    className="text-muted-foreground hover:text-foreground"
                    title={c.occam_invited
                      ? 'Clear the Occam-invited flag (they will be prompted again before their next first delivery)'
                      : 'Mark that this contact has been invited to Occam (skips the delivery prompt)'}
                  >
                    {c.occam_invited ? 'Unmark Occam' : 'Mark Occam invited'}
                  </button>
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
                    {/* An archived contact keeps their page — past projects still
                        resolve to them — so the name stays a link, just muted. */}
                    <p className="text-sm text-muted-foreground truncate">
                      <Link
                        href={`/contacts/${c.id}`}
                        className="hover:text-foreground hover:underline transition-colors"
                        title={`Open ${contactName(c)}'s page — every survey they requested`}
                      >
                        {contactName(c)}
                      </Link>
                    </p>
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
