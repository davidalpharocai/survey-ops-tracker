import Link from 'next/link';
import { notFound } from 'next/navigation';

import { apiForRequest } from '../../lib/action';
import { currentUserIsAdmin } from '../../lib/auth';
import type { AuditLog, AuditLogFilters } from '../../lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Audit log · AlphaROC' };

const ACTIONS = ['create', 'update', 'delete'];
const OUTCOMES = ['success', 'denied', 'error'];
const RESOURCES = ['clients', 'users', 'contracts', 'studies', 'transactions'];

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

// Compact UTC rendering, e.g. "2026-06-04 14:30:28".
function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

// Pretty-print the captured JSON body for the detail row.
function fmtBody(body: string | null): string {
  if (!body) return '';
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

export default async function AdminAuditPage({ searchParams }: PageProps) {
  if (!(await currentUserIsAdmin())) notFound();

  const sp = await searchParams;
  const filters: AuditLogFilters = {
    actor: sp.actor || undefined,
    action: sp.action || undefined,
    resource_type: sp.resource_type || undefined,
    status_code: sp.status_code || undefined,
    outcome: sp.outcome || undefined,
    q: sp.q || undefined,
    from: sp.from || undefined,
    to: sp.to || undefined,
    queryId: sp.queryId || undefined,
    nextToken: sp.nextToken || undefined,
  };

  const api = await apiForRequest();
  let rows: AuditLog[] = [];
  let nextToken: string | null = null;
  let queryId: string | null = null;
  let athena = true;
  let error = '';
  try {
    const page = await api.listAuditLogs(filters);
    rows = page.rows;
    nextToken = page.nextToken;
    queryId = page.queryId;
    athena = page.athena !== false;
  } catch (e) {
    error = e instanceof Error ? e.message : 'Query failed.';
  }

  // Build the "next page" link: keep the active filters, swap in the
  // pagination cursor returned by Athena.
  const nextParams = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v && k !== 'queryId' && k !== 'nextToken') nextParams.set(k, String(v));
  }
  if (queryId && nextToken) {
    nextParams.set('queryId', queryId);
    nextParams.set('nextToken', nextToken);
  }

  return (
    <>
      <Link className="back" href="/">← Home</Link>
      <h1>Audit log</h1>
      <p className="muted small">
        Every write action (create / update / delete) and denied attempt, newest
        first. Logs are retained for a year and backed up to S3.
      </p>

      <form method="get" className="filterbar">
        <label>Actor
          <input type="text" name="actor" defaultValue={sp.actor || ''} placeholder="email" />
        </label>
        <label>Action
          <select name="action" defaultValue={sp.action || ''}>
            <option value="">any</option>
            {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label>Resource
          <select name="resource_type" defaultValue={sp.resource_type || ''}>
            <option value="">any</option>
            {RESOURCES.map(rt => <option key={rt} value={rt}>{rt}</option>)}
          </select>
        </label>
        <label>Outcome
          <select name="outcome" defaultValue={sp.outcome || ''}>
            <option value="">any</option>
            {OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label>Status
          <input type="number" name="status_code" defaultValue={sp.status_code || ''} placeholder="200" />
        </label>
        <label>From
          <input type="date" name="from" defaultValue={sp.from || ''} />
        </label>
        <label>To
          <input type="date" name="to" defaultValue={sp.to || ''} />
        </label>
        <label>Search
          <input type="text" name="q" defaultValue={sp.q || ''} placeholder="path or actor" />
        </label>
        <button className="btn" type="submit">Filter</button>
        <Link className="back" href="/admin">Reset</Link>
      </form>

      {!athena && (
        <p className="muted">
          Audit querying is not configured in this environment (Athena is only
          wired up in the deployed stack).
        </p>
      )}
      {error && <p className="neg">Could not load audit logs: {error}</p>}

      {athena && !error && (
        <>
          <table className="report compact">
            <thead>
              <tr>
                <th>Time (UTC)</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Resource</th>
                <th>Outcome</th>
                <th className="num">Status</th>
                <th className="num">ms</th>
                <th>IP</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((rrow, i) => (
                <tr key={`${rrow.occurredAt}-${i}`}>
                  <td>{fmtTime(rrow.occurredAt)}</td>
                  <td>{rrow.actorEmail || <span className="muted">—</span>}</td>
                  <td>{rrow.action || rrow.method}</td>
                  <td>
                    {rrow.resourceType || '—'}
                    {rrow.resourceId ? ` #${rrow.resourceId}` : ''}
                  </td>
                  <td>
                    <span className={`tag tag-${rrow.outcome}`}>{rrow.outcome}</span>
                  </td>
                  <td className="num">{rrow.statusCode ?? '—'}</td>
                  <td className="num">{rrow.durationMs ?? '—'}</td>
                  <td>{rrow.ipAddress || '—'}</td>
                  <td>
                    <details>
                      <summary className="muted small">view</summary>
                      <div className="audit-detail">
                        <div><strong>{rrow.method}</strong> {rrow.path}</div>
                        {rrow.userAgent && <div className="muted small">{rrow.userAgent}</div>}
                        {rrow.requestBody && <pre>{fmtBody(rrow.requestBody)}</pre>}
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted">No audit entries match these filters.</td>
                </tr>
              )}
            </tbody>
          </table>

          {queryId && nextToken && (
            <p>
              <Link className="btn btn-sm" href={`/admin?${nextParams.toString()}`}>
                Load next page →
              </Link>
            </p>
          )}
        </>
      )}
    </>
  );
}
