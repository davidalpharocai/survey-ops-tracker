// Authenticated download proxy for contract attachments.
//
// The browser talks only to this frontend (gated by middleware — Basic Auth
// or Cognito); it never calls the backend directly and doesn't hold the
// identity/service headers the backend expects. So a download is proxied:
// this handler attaches those headers, streams the bytes straight through,
// and re-asserts the safe response headers (attachment disposition + nosniff)
// so a file can never render inline in the app origin.

import { NextRequest } from 'next/server';

import { authHeaders, BACKEND_BASE } from '../../../../lib/api';
import { currentUserEmail } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const attId = parseInt(id, 10);
  if (!Number.isFinite(attId) || attId <= 0) {
    return new Response('Not found', { status: 404 });
  }

  const email = await currentUserEmail();
  const res = await fetch(
    `${BACKEND_BASE}/api/attachments/${attId}/download`,
    { headers: await authHeaders(email), cache: 'no-store' },
  );
  if (!res.ok) {
    // 404 hides both missing and not-visible attachments; anything else is an
    // upstream failure.
    return new Response('Not found', { status: res.status === 404 ? 404 : 502 });
  }

  const out = new Headers();
  const cd = res.headers.get('content-disposition');
  const ct = res.headers.get('content-type');
  // Force attachment disposition here too (not just when upstream sends it),
  // so this proxy is an independent safety layer: a file can never render
  // inline in the app origin even if the backend ever omitted the header.
  out.set('Content-Disposition', cd || 'attachment');
  out.set('Content-Type', ct || 'application/octet-stream');
  out.set('X-Content-Type-Options', 'nosniff');
  out.set('Cache-Control', 'private, no-store');
  return new Response(res.body, { status: 200, headers: out });
}
