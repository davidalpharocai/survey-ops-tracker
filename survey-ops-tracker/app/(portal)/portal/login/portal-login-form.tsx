'use client'
import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function PortalLoginForm() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const searchParams = useSearchParams()
  const next = searchParams.get('next') ?? '/portal'
  const linkError = searchParams.get('error')

  async function handleSendLink(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    })
    setLoading(false)
    if (error) {
      setError(
        error.message.includes('Signups not allowed')
          ? 'This email is not registered for portal access. Contact your AlphaRoc representative.'
          : error.message
      )
      return
    }
    setSent(true)
  }

  if (sent) {
    return (
      <div className="w-full max-w-sm p-8 bg-slate-900 rounded-xl border border-slate-800 text-center">
        <h1 className="text-lg font-bold text-white mb-2">Check your email</h1>
        <p className="text-sm text-slate-400">
          We sent a sign-in link to <span className="text-slate-200">{email}</span>.
          Click it to access the compliance portal.
        </p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm p-8 bg-slate-900 rounded-xl border border-slate-800">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Compliance Portal</h1>
        <p className="text-sm text-slate-400 mt-1">
          Enter your email and we&apos;ll send you a sign-in link.
        </p>
      </div>
      {linkError && (
        <p className="text-amber-400 text-sm bg-amber-400/10 px-3 py-2 rounded-lg mb-4">
          {linkError === 'profile'
            ? 'We could not load your portal profile. Try signing in again, or contact your AlphaRoc representative.'
            : 'That sign-in link expired or was already used. Request a new one below.'}
        </p>
      )}
      <form onSubmit={handleSendLink} className="flex flex-col gap-4">
        <Input
          type="email"
          placeholder="you@company.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
        />
        {error && (
          <p className="text-red-400 text-sm bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>
        )}
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? 'Sending...' : 'Send sign-in link'}
        </Button>
      </form>
    </div>
  )
}
