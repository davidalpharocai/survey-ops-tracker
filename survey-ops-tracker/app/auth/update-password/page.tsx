'use client'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// Where invite + password-recovery links land (via /auth/confirm) so the user can
// choose a password before entering the app. The recovery/invite link already
// created a session when it hit /auth/confirm; here we just set the password.
function UpdatePasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const rawNext = searchParams.get('next') || '/'
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/'

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState<boolean | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data }) => setReady(!!data.session))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Those passwords do not match.')
      return
    }
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    router.replace(next)
    router.refresh()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm p-8 bg-card rounded-xl border border-border">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-foreground">Set your password</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Choose a password to finish setting up your Survey Ops account.
          </p>
        </div>
        {ready === false ? (
          <p className="text-amber-600 dark:text-amber-400 text-sm bg-amber-400/10 px-3 py-2 rounded-lg leading-relaxed">
            This link is no longer valid — it may have expired or already been used. Head to the{' '}
            <a href="/login" className="underline">sign-in page</a> or ask David for a fresh link.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input
              type="password"
              placeholder="New password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoFocus
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
            <Input
              type="password"
              placeholder="Confirm password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
            {error && (
              <p className="text-red-600 dark:text-red-400 text-sm bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>
            )}
            <Button type="submit" disabled={loading || ready === null} className="w-full">
              {loading ? 'Saving…' : 'Set password & continue'}
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}

export default function UpdatePasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <div className="text-muted-foreground text-sm">Loading…</div>
        </div>
      }
    >
      <UpdatePasswordForm />
    </Suspense>
  )
}
