'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ALLOWED_EMAIL_DOMAIN } from '@/lib/utils/allowedDomain'

// Passwordless: enter your @alpharoc.ai username → one-tap magic sign-in link.
// The account is always @alpharoc.ai (field is domain-locked); shouldCreateUser
// is false so only accounts an admin has provisioned can sign in. The server
// still re-checks the domain on every page load (see (app)/layout.tsx).
const localPart = (v: string) => v.trim().split('@')[0]
const toEmail = (username: string) => `${localPart(username)}@${ALLOWED_EMAIL_DOMAIN}`

function EmailField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-stretch rounded-md border border-border bg-muted overflow-hidden focus-within:border-ring">
      <input
        id={id}
        type="text"
        inputMode="email"
        autoComplete="username"
        autoFocus
        aria-label={`Your @${ALLOWED_EMAIL_DOMAIN} username`}
        placeholder="you"
        value={value}
        onChange={e => onChange(e.target.value)}
        required
        className="flex-1 min-w-0 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
      />
      <span className="flex items-center px-3 text-sm text-muted-foreground border-l border-border select-none whitespace-nowrap">
        @{ALLOWED_EMAIL_DOMAIN}
      </span>
    </div>
  )
}

export default function LoginForm() {
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const searchParams = useSearchParams()
  const supabase = createClient()

  // Kicked out by the server for a non-company account: end the session
  useEffect(() => {
    if (searchParams.get('unauthorized')) {
      supabase.auth.signOut()
      setError(`Only @${ALLOWED_EMAIL_DOMAIN} accounts can access this app.`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const linkExpired = searchParams.get('error') === 'link'
  const nextParam = searchParams.get('next')
  const safeNext =
    nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') && !nextParam.includes('\\') ? nextParam : '/'

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!localPart(username)) {
      setError(`Enter your @${ALLOWED_EMAIL_DOMAIN} username.`)
      return
    }
    setLoading(true)
    const emailRedirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext)}`
    const { error } = await supabase.auth.signInWithOtp({
      email: toEmail(username),
      options: { emailRedirectTo, shouldCreateUser: false },
    })
    setLoading(false)
    if (error) {
      const m = error.message
      setError(
        /after|rate limit/i.test(m)
          ? 'A link was sent recently — wait a minute, then try again (check spam too).'
          : /signup|not allowed|not found|no user/i.test(m)
            ? `No @${ALLOWED_EMAIL_DOMAIN} account with that username yet — ask an admin to add you.`
            : m
      )
      return
    }
    setSent(true)
  }

  if (sent) {
    return (
      <div className="w-full max-w-sm p-8 bg-card rounded-xl border border-border text-center">
        <h1 className="text-lg font-bold text-foreground mb-2">Check your email</h1>
        <p className="text-sm text-muted-foreground">
          We sent a one-tap sign-in link to{' '}
          <span className="text-foreground font-medium">{toEmail(username)}</span>. Open it on this device to finish
          signing in. (Check spam if you don&apos;t see it — the link expires in 1 hour.)
        </p>
        <button
          type="button"
          onClick={() => setSent(false)}
          className="text-sm text-muted-foreground hover:text-foreground mt-4"
        >
          ← Use a different account
        </button>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm p-8 bg-card rounded-xl border border-border">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">Survey Ops Command Center</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Sign in with your @{ALLOWED_EMAIL_DOMAIN} account — no password needed.
        </p>
      </div>
      {linkExpired && (
        <p className="text-amber-600 dark:text-amber-400 text-sm bg-amber-400/10 px-3 py-2 rounded-lg mb-4">
          That sign-in link didn&apos;t work — it may have expired, been used already, or been opened on a
          different device than you requested it from. Enter your username below for a fresh one, and open it on this device.
        </p>
      )}
      <form onSubmit={handleSend} className="flex flex-col gap-4">
        <EmailField id="username" value={username} onChange={setUsername} />
        {error && (
          <p className="text-red-600 dark:text-red-400 text-sm bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>
        )}
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? 'Sending…' : 'Email me a sign-in link'}
        </Button>
        <p className="text-xs text-muted-foreground text-center">
          We&apos;ll email a secure one-tap link — open it on this device to sign in.
        </p>
      </form>
    </div>
  )
}
