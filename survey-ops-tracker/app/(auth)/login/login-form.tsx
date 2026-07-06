'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { isAllowedEmail, ALLOWED_EMAIL_DOMAIN } from '@/lib/utils/allowedDomain'

export default function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'signin' | 'reset' | 'reset-sent'>('signin')
  const [resetEmail, setResetEmail] = useState('')
  const [resetError, setResetError] = useState('')
  const [resetLoading, setResetLoading] = useState(false)
  const router = useRouter()
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

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!isAllowedEmail(email)) {
      setError(`Only @${ALLOWED_EMAIL_DOMAIN} accounts can access this app.`)
      return
    }
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    router.push('/')
    router.refresh()
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setResetError('')
    if (!isAllowedEmail(resetEmail)) {
      setResetError(`Only @${ALLOWED_EMAIL_DOMAIN} accounts can access this app.`)
      return
    }
    setResetLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail)
    setResetLoading(false)
    if (error) {
      setResetError(
        error.message.includes('you can only request this after') || error.message.includes('rate limit')
          ? 'A link was already sent recently — wait a minute, then try again. And check your spam folder.'
          : error.message
      )
      return
    }
    setMode('reset-sent')
  }

  if (mode === 'reset-sent') {
    return (
      <div className="w-full max-w-sm p-8 bg-card rounded-xl border border-border text-center">
        <h1 className="text-lg font-bold text-foreground mb-2">Check your email</h1>
        <p className="text-sm text-muted-foreground">
          Check your email — we sent you a link to set your password. It expires in 1 hour.
          (Check spam if you don&apos;t see it.)
        </p>
      </div>
    )
  }

  if (mode === 'reset') {
    return (
      <div className="w-full max-w-sm p-8 bg-card rounded-xl border border-border">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-foreground">Set or reset password</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Enter your work email and we&apos;ll send you a link to set a new password.
          </p>
        </div>
        <form onSubmit={handleReset} className="flex flex-col gap-4">
          <Input
            type="email"
            placeholder="Email"
            value={resetEmail}
            onChange={e => setResetEmail(e.target.value)}
            required
            className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
          />
          {resetError && (
            <p className="text-red-600 dark:text-red-400 text-sm bg-red-400/10 px-3 py-2 rounded-lg">{resetError}</p>
          )}
          <Button type="submit" disabled={resetLoading} className="w-full">
            {resetLoading ? 'Sending…' : 'Email me a set-password link'}
          </Button>
          <button
            type="button"
            onClick={() => setMode('signin')}
            className="text-sm text-muted-foreground hover:text-foreground text-center"
          >
            ← Back to sign in
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm p-8 bg-card rounded-xl border border-border">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">Survey Ops Command Center</h1>
        <p className="text-sm text-muted-foreground mt-1">Sign in to your workspace</p>
      </div>
      {linkExpired && (
        <p className="text-amber-600 dark:text-amber-400 text-sm bg-amber-400/10 px-3 py-2 rounded-lg mb-4">
          That sign-in link has expired or was already used. If you haven&apos;t set a password
          yet — or forgot it — use &ldquo;Set or reset password&rdquo; below to email yourself a
          fresh link.
        </p>
      )}
      <form onSubmit={handleLogin} className="flex flex-col gap-4">
        <Input
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
        />
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
        />
        {error && (
          <p className="text-red-600 dark:text-red-400 text-sm bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>
        )}
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? 'Signing in...' : 'Sign in'}
        </Button>
        <button
          type="button"
          onClick={() => {
            setResetEmail(email)
            setMode('reset')
          }}
          className="text-sm text-muted-foreground hover:text-foreground text-center"
        >
          First time here or forgot your password? Set or reset it
        </button>
      </form>
    </div>
  )
}
