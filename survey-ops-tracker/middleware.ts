import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Auth is handled server-side in app/(app)/layout.tsx
export function middleware(_request: NextRequest) {
  return NextResponse.next()
}

// Empty matcher — middleware runs on no routes
export const config = { matcher: [] }
