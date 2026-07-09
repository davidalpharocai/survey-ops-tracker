// GET /api/search?q=… — omnibox backend. Runs server-side so the browser
// never sees the backend service secret; forwards to the FastAPI search
// endpoint as the acting user.

import { NextRequest, NextResponse } from 'next/server';

import { apiForRequest } from '../../../lib/action';
import { currentUserEmail } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

const EMPTY = { clients: [], contracts: [], studies: [], contacts: [] };

export async function GET(req: NextRequest): Promise<NextResponse> {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json(EMPTY, { status: 401 });

  const q = (req.nextUrl.searchParams.get('q') || '').slice(0, 100).trim();
  if (!q) return NextResponse.json(EMPTY);

  const api = await apiForRequest();
  try {
    const data = await api.search(q);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    // Never surface a 500 into the type-ahead; degrade to no results.
    return NextResponse.json(EMPTY);
  }
}
