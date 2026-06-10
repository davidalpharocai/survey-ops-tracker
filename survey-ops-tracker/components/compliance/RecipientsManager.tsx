'use client'
import { useState } from 'react'
import { useRecipients, useInvalidateCompliance, type Recipient } from '@/lib/hooks/useSubmissions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function RecipientsManager({ projectId }: { projectId: string }) {
  const { data: recipients = [] } = useRecipients(projectId)
  const invalidate = useInvalidateCompliance(projectId)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'compliance' | 'alpharoc'>('compliance')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function addRecipient(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/projects/${projectId}/recipients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Failed to add recipient')
        return
      }
      setEmail('')
      invalidate()
    } catch {
      setError('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function removeRecipient(r: Recipient) {
    try {
      const res = await fetch(`/api/projects/${projectId}/recipients`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientId: r.id }),
      })
      if (!res.ok) {
        setError('Could not remove recipient — please try again.')
      }
    } catch {
      setError('Could not remove recipient — please try again.')
    } finally {
      invalidate()
    }
  }

  function group(role: Recipient['role'], label: string) {
    const list = recipients.filter(r => r.role === role)
    return (
      <div className="mb-3">
        <p className="text-xs text-slate-500 mb-1">{label}</p>
        {list.length === 0 ? (
          <p className="text-xs text-slate-600">None yet</p>
        ) : (
          list.map(r => (
            <div key={r.id} className="flex items-center justify-between text-xs py-1">
              <span className="text-slate-300">{r.email}</span>
              <button
                onClick={() => removeRecipient(r)}
                className="text-slate-600 hover:text-red-400 transition-colors"
                aria-label={`Remove ${r.email}`}
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    )
  }

  return (
    <div>
      {group('compliance', 'Client compliance reviewers')}
      {group('alpharoc', 'AlphaRoc notify list')}
      <form onSubmit={addRecipient} className="flex gap-2 mt-2">
        <Input
          type="email"
          placeholder="email@company.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 text-xs h-8"
        />
        <select
          value={role}
          onChange={e => setRole(e.target.value as 'compliance' | 'alpharoc')}
          aria-label="Recipient role"
          className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded-md px-2"
        >
          <option value="compliance">Compliance</option>
          <option value="alpharoc">AlphaRoc</option>
        </select>
        <Button type="submit" disabled={busy} className="h-8 text-xs">
          Add
        </Button>
      </form>
      {error && <p role="alert" className="text-red-400 text-xs mt-2">{error}</p>}
    </div>
  )
}
