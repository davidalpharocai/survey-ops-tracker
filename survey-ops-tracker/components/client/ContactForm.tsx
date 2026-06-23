'use client'
import { useState } from 'react'
import type { ClientContact } from '@/lib/utils/contact'

export type ContactDraft = {
  first_name: string
  last_name: string
  email: string
  title: string
  phone: string
}

export function emptyDraft(): ContactDraft {
  return { first_name: '', last_name: '', email: '', title: '', phone: '' }
}

export function contactToDraft(c: ClientContact): ContactDraft {
  return {
    first_name: c.first_name,
    last_name: c.last_name,
    email: c.email ?? '',
    title: c.title ?? '',
    phone: c.phone ?? '',
  }
}

/** Trim and turn empty optionals into null for persistence. */
export function draftToFields(d: ContactDraft) {
  const t = (s: string) => s.trim() || null
  return {
    first_name: d.first_name.trim(),
    last_name: d.last_name.trim(),
    email: t(d.email),
    title: t(d.title),
    phone: t(d.phone),
  }
}

const inputCls =
  'w-full bg-muted border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-ring'

export function ContactForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  initial: ContactDraft
  submitLabel: string
  busy?: boolean
  onSubmit: (d: ContactDraft) => void
  onCancel: () => void
}) {
  const [d, setD] = useState(initial)
  const valid = d.first_name.trim() !== '' && d.last_name.trim() !== ''
  const set =
    (k: keyof ContactDraft) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setD(p => ({ ...p, [k]: e.target.value }))

  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-2 gap-1.5">
        <input autoFocus value={d.first_name} onChange={set('first_name')} placeholder="First name *" className={inputCls} />
        <input value={d.last_name} onChange={set('last_name')} placeholder="Last name *" className={inputCls} />
      </div>
      <input value={d.email} onChange={set('email')} placeholder="Email (optional)" className={inputCls} />
      <input value={d.title} onChange={set('title')} placeholder="Title (optional)" className={inputCls} />
      <input value={d.phone} onChange={set('phone')} placeholder="Phone (optional)" className={inputCls} />
      <div className="flex justify-end gap-2 mt-0.5">
        <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 transition-colors">
          Cancel
        </button>
        <button
          onClick={() => valid && !busy && onSubmit(d)}
          disabled={!valid || busy}
          className="text-xs bg-blue-600 text-white rounded px-2.5 py-1 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </div>
  )
}
