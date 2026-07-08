// Harness: exercise frontend/lib/importer.ts (buildPlan + applyPlan)
// against the local backend, bypassing the browser UI (which is just a
// thin shell around these two calls). Run:
//   npx tsx test-importer.mts <xlsx> [--apply]
import { readFileSync } from 'node:fs';

import type { ApiClient } from '../frontend/lib/api';
import { applyPlan, buildPlan } from '../frontend/lib/importer';

const BASE = process.env.BACKEND_URL || 'http://127.0.0.1:8000';
const EMAIL = 'david@alpharoc.ai';

async function req(method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-User-Email': EMAIL },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${data?.detail ?? text}`);
  return data;
}

// Just the surface importer.ts uses.
const client = {
  listClients: () => req('GET', '/api/clients'),
  listClientsWithUsers: () => req('GET', '/api/clients?include=users'),
  listClientUsers: (id: number) => req('GET', `/api/clients/${id}/users`),
  listContractsByClient: (id: number) => req('GET', `/api/clients/${id}/contracts`),
  listStudiesByClient: (id: number) => req('GET', `/api/clients/${id}/studies`),
  createClient: (d: unknown) => req('POST', '/api/clients', d),
  updateClient: (id: number, d: unknown) => req('PATCH', `/api/clients/${id}`, d),
  createClientUser: (id: number, d: unknown) => req('POST', `/api/clients/${id}/users`, d),
  updateClientUser: (id: number, d: unknown) => req('PATCH', `/api/users/${id}`, d),
  createContract: (d: unknown) => req('POST', '/api/contracts', d),
  updateContract: (id: number, d: unknown) => req('PATCH', `/api/contracts/${id}`, d),
  createStudy: (d: unknown) => req('POST', '/api/studies', d),
  updateStudy: (id: number, d: unknown) => req('PATCH', `/api/studies/${id}`, d),
} as unknown as ApiClient;

const file = process.argv[2];
const doApply = process.argv.includes('--apply');
if (!file) throw new Error('usage: npx tsx test-importer.mts <xlsx> [--apply]');

const bytes = readFileSync(file);
const plan = await buildPlan(
  client,
  file.split(/[\\/]/).pop()!,
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
);

console.log(`format=${plan.format} counts=${JSON.stringify(plan.counts)}`);
for (const r of plan.rows.filter(x => x.action !== 'unchanged')) {
  console.log(
    `  [${r.action}] ${r.tab} :: ${r.client} :: ${r.name}` +
      (r.error ? ` ERROR: ${r.error}` : '') +
      (r.changes.length ? ' | ' + r.changes.map(c => `${c.field}: ${c.from || '∅'}→${c.to}`).join('; ') : ''),
  );
}

if (doApply) {
  const res = await applyPlan(client, plan);
  console.log(`applied=${res.applied} failed=${res.failed}`);
  for (const r of res.rows.filter(x => !x.ok)) {
    console.log(`  FAIL ${r.tab} :: ${r.client} :: ${r.name} :: ${r.message}`);
  }
}
