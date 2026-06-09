import { NextResponse, type NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Let the login page through always
  if (pathname.startsWith('/login')) {
    return NextResponse.next()
  }

  // Supabase stores auth tokens in cookies named sb-*-auth-token or sb-*-auth-token.0
  const cookies = request.cookies.getAll()
  const hasAuthToken = cookies.some(
    c => c.name.includes('auth-token') && c.value.length > 0
  )

  if (!hasAuthToken) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
