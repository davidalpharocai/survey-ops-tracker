import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAllowedEmail } from '@/lib/utils/allowedDomain'
import { getClient } from '@/lib/oauth/store'
import { MCP_RESOURCE } from '@/lib/oauth/http'
import { Button } from '@/components/ui/button'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { allowAction, denyAction, reauthAction } from './actions'

export const dynamic = 'force-dynamic'

type SearchParams = {
  client_id?: string
  redirect_uri?: string
  state?: string
  code_challenge?: string
  code_challenge_method?: string
  scope?: string
  resource?: string
  response_type?: string
  error?: string
}

function ErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm p-8 bg-card rounded-xl border border-border text-center">
        <h1 className="text-lg font-bold text-foreground mb-2">{title}</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  )
}

// Signed in, but not with an @alpharoc.ai analyst account. Instead of a dead end,
// offer a one-click switch: sign this account out and return to the same connect
// request after logging in as an analyst.
function NotAvailableCard({ selfUrl }: { selfUrl: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm p-8 bg-card rounded-xl border border-border text-center">
        <h1 className="text-lg font-bold text-foreground mb-2">Wrong account</h1>
        <p className="text-sm text-muted-foreground mb-4">
          You&apos;re signed in with an account that can&apos;t use this connector — it&apos;s for
          internal AlphaROC analysts. Sign in with your @alpharoc.ai analyst account to continue.
        </p>
        <form action={reauthAction.bind(null, selfUrl)}>
          <Button type="submit" className="w-full mb-2">Sign in with a different account</Button>
        </form>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground underline">
          Return to Survey Ops
        </Link>
      </div>
    </div>
  )
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const { client_id: clientId, redirect_uri: redirectUri, state, code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod, response_type: responseType, resource } = params

  // ---- Validation cascade: every failure below renders an on-page error,
  // never a redirect — redirecting to an unvalidated redirect_uri is the
  // classic authorization-code exfiltration vector. ----

  if (!clientId) {
    return <ErrorCard title="Missing client" message="This authorization request is missing a client_id." />
  }
  const client = await getClient(clientId)
  if (!client) {
    return <ErrorCard title="Unknown client" message="This connector is not registered with Survey Ops." />
  }
  const registeredUris = (client.redirect_uris ?? []) as string[]
  if (!redirectUri || !registeredUris.includes(redirectUri)) {
    return (
      <ErrorCard
        title="Invalid redirect"
        message="The redirect address for this connector doesn't match what was registered. For your safety, we won't continue."
      />
    )
  }
  if (responseType !== 'code') {
    return <ErrorCard title="Unsupported request" message="Only the authorization code flow is supported." />
  }
  if (!codeChallenge) {
    return <ErrorCard title="Missing PKCE challenge" message="This authorization request is missing a required security parameter." />
  }
  if (codeChallengeMethod !== 'S256') {
    return <ErrorCard title="Unsupported PKCE method" message="Only the S256 code challenge method is supported." />
  }
  if (resource && resource !== MCP_RESOURCE()) {
    return <ErrorCard title="Unknown resource" message="This authorization request targets a resource Survey Ops doesn't recognize." />
  }

  // ---- Session gate ----
  // The full current authorize request (path + query) — used to return here after
  // a login or an account switch, so the connect flow resumes exactly where it was.
  const selfQs = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => typeof e[1] === 'string')
  ).toString()
  const selfUrl = `/oauth/authorize${selfQs ? `?${selfQs}` : ''}`

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(selfUrl)}`)
  }

  // Signed in with a non-@alpharoc.ai account (e.g. a compliance/portal login or
  // the wrong Google account) → offer a one-click switch rather than a dead end.
  if (!isAllowedEmail(user.email)) {
    return <NotAvailableCard selfUrl={selfUrl} />
  }

  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (!profile || profile.role !== 'analyst') {
    return <NotAvailableCard selfUrl={selfUrl} />
  }

  const redirectHost = new URL(redirectUri).host

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm p-8 bg-card rounded-xl border border-border">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-foreground">Connect {client.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {client.name} wants to connect to your Survey Ops Command Center account.
            This will return you to <span className="font-medium text-foreground">{redirectHost}</span>.
          </p>
        </div>
        <div className="mb-6 flex flex-col gap-2 text-sm text-foreground">
          <div className="flex items-start gap-2">
            <span aria-hidden className="mt-0.5 text-muted-foreground">-</span>
            <span>Read your Survey Ops projects</span>
          </div>
          <div className="flex items-start gap-2">
            <span aria-hidden className="mt-0.5 text-muted-foreground">-</span>
            <span>Manage your reminders</span>
          </div>
        </div>
        {/* Next.js server actions carry built-in same-origin POST checks — no
            separate CSRF token is needed for these forms. */}
        <div className="flex flex-col gap-2">
          <form
            action={allowAction.bind(null, {
              client_id: clientId,
              redirect_uri: redirectUri,
              state,
              code_challenge: codeChallenge,
            })}
          >
            <Button type="submit" className="w-full">Allow</Button>
          </form>
          <form
            action={denyAction.bind(null, {
              client_id: clientId,
              redirect_uri: redirectUri,
              state,
            })}
          >
            <Button type="submit" variant="ghost" className="w-full">Deny</Button>
          </form>
        </div>
      </div>
    </div>
  )
}
