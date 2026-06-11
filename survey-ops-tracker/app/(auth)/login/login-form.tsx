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

  return (
    <div className="w-full max-w-sm p-8 bg-card rounded-xl border border-border">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">Survey Ops Tracker</h1>
        <p className="text-sm text-muted-foreground mt-1">Sign in to your workspace</p>
      </div>
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
      </form>
    </div>
  )
}
