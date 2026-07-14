import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Keeps users signed in across visits. Server Components can't write cookies
// (see the swallowed setAll in lib/supabase/server.ts), so without this the
// rotating Supabase refresh token is never persisted and sessions silently drop
// once the short-lived access token expires. This runs on every page request,
// refreshes the token, and writes the rotated auth cookies onto the response.
//
// Deliberately does NOT redirect/gate — route protection stays in
// app/(app)/layout.tsx and the portal layout, so this can't fight them.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    }
  )

  // Triggers a refresh when the access token is stale; setAll above persists the
  // rotated tokens onto the response. Never throws into the request.
  try {
    await supabase.auth.getUser()
  } catch {
    // Auth service hiccup — don't block the page; the layout still gates access.
  }

  return response
}

export const config = {
  // Run on page requests to refresh the session cookie; skip API routes and the
  // /auth/* token-exchange handlers (they set their own cookies — don't let a
  // getUser here disturb the magic-link PKCE exchange) and static assets. A
  // valid, NON-empty matcher — an empty one previously failed the Vercel deploy.
  matcher: ['/((?!api|auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
