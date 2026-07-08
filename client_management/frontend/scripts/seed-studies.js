// Import studies from a backend export.
//
// Inputs (in data/):
//   studies_export.csv  — one row per study (id, title, description,
//                         created_at, ...). No client column.
//   studies_xref.csv    — one row per user (user_id, email, study_ids,
//                         study_titles). Lists every study they can see.
//
// Approach (since neither file has a study→client column):
//   For each study, walk the xref to find the first NON-AlphaROC user who
//   has it. Look up that user in the DB by email. Use their clientId as
//   the study's client and clientUserId as the attribution. Insert as a
//   Transaction(kind='study', cost=0). Mark with a note so the team knows
//   the cost is still pending.
//
// Studies whose only xref users are internal (alpharoc.ai/occam.ai) are
// skipped with a count, as are studies whose external user isn't in our DB.
// Existing transactions with the same (kind, client, user, name) are
// skipped so re-running is safe.
//
// Usage:
//   npm run seed:studies
//   npm run seed:studies -- --dry-run

import fs from 'node:fs';
import process from 'node:process';

import { pool, query, camelize } from '../src/lib/db.js';
import { createTransaction, addTxUsers } from '../src/lib/repo.js';

const STUDIES_CSV = 'data/studies_export.csv';
const XREF_CSV = 'data/studies_xref.csv';
const ORPHAN_CSV = 'data/orphan_studies.csv';
const SEED_ACTOR = 'seed@alpharoc.ai';
const NOTE = 'Imported from CSV; cost not recorded';

const SKIP_DOMAINS = new Set([
  'alpharoc.ai', 'occam.ai',
  'tedi.ai', 'tediredict.ai', 'tedirec.ai', 'teditest.ai',
  'testaccount.ai', 'testaccount.al', 'test.io', 'proton.me',
]);

// Tiny CSV parser that handles quoted fields with embedded commas/newlines.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuote = false;
      else cur += ch;
    } else {
      if (ch === '"') inQuote = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (ch !== '\r') cur += ch;
    }
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function readCsv(path) {
  const raw = fs.readFileSync(path, 'utf-8').replace(/^﻿/, '');
  const rows = parseCsv(raw);
  const header = rows[0].map(h => h.replace(/^﻿/, ''));
  const data = rows.slice(1).map(r => {
    const o = {};
    header.forEach((h, i) => { o[h] = r[i]; });
    return o;
  });
  return { header, data };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (!fs.existsSync(STUDIES_CSV) || !fs.existsSync(XREF_CSV)) {
    console.error(`ERROR: missing ${STUDIES_CSV} or ${XREF_CSV}.`);
    process.exit(1);
  }

  const { data: studies } = readCsv(STUDIES_CSV);
  const studyById = new Map();
  for (const s of studies) {
    if (s.id) studyById.set(s.id, s);
  }
  console.log(`Loaded ${studyById.size} studies from ${STUDIES_CSV}`);

  const { data: xrefRows } = readCsv(XREF_CSV);
  console.log(`Loaded ${xrefRows.length} xref rows from ${XREF_CSV}`);

  // Build study_id -> ordered list of non-internal user emails who have it.
  const studyToEmails = new Map();
  for (const x of xrefRows) {
    const email = (x.email || '').trim().toLowerCase();
    if (!email) continue;
    const domain = email.split('@')[1] || '';
    if (SKIP_DOMAINS.has(domain)) continue;
    const ids = (x.study_ids || '').split(',').map(s => s.trim()).filter(Boolean);
    for (const sid of ids) {
      if (!studyToEmails.has(sid)) studyToEmails.set(sid, []);
      studyToEmails.get(sid).push(email);
    }
  }
  console.log(`${studyToEmails.size} studies have at least one non-internal candidate user.`);

  // Cache email -> ClientUser to avoid repeated DB lookups
  const emailToCu = new Map();
  async function findClientUser(email) {
    if (emailToCu.has(email)) return emailToCu.get(email);
    const { rows } = await query(
      'SELECT * FROM client_users WHERE email = $1 LIMIT 1',
      [email],
    );
    const cu = camelize(rows[0]);
    emailToCu.set(email, cu);
    return cu;
  }

  let inserted = 0;
  let usersAdded = 0;
  let skippedNoUser = 0;
  let skippedNoMatch = 0;
  let skippedDup = 0;
  const orphans = []; // rows for orphan_studies.csv
  const unmatchedExamples = [];

  for (const [sid, study] of studyById.entries()) {
    const candidates = studyToEmails.get(sid) || [];
    if (candidates.length === 0) {
      skippedNoUser++;
      orphans.push({
        reason: 'no_external_user',
        study_id: sid,
        title: study.title || '',
        description: study.description || '',
        created_at: study.created_at || '',
        candidate_email: '',
        candidate_domain: '',
      });
      continue;
    }

    // Resolve every non-internal candidate user we have in the DB.
    const matchedUsers = [];
    for (const email of candidates) {
      const found = await findClientUser(email);
      if (found) matchedUsers.push(found);
    }
    if (matchedUsers.length === 0) {
      skippedNoMatch++;
      const first = candidates[0];
      orphans.push({
        reason: 'external_user_not_in_db',
        study_id: sid,
        title: study.title || '',
        description: study.description || '',
        created_at: study.created_at || '',
        candidate_email: first,
        candidate_domain: first.split('@')[1] || '',
      });
      if (unmatchedExamples.length < 8) {
        unmatchedExamples.push(`${sid} (${first}): ${study.title}`);
      }
      continue;
    }

    // The "primary" client for this study is the first matched user's client.
    // If matched users span multiple clients (rare), only attribute the ones
    // at that primary client to keep things consistent.
    const primaryClientId = matchedUsers[0].clientId;
    const usersForThisStudy = matchedUsers.filter(
      u => u.clientId === primaryClientId,
    );

    const occurredOn = study.created_at ? new Date(study.created_at) : new Date();
    const title = (study.title || 'Untitled study').trim() || 'Untitled study';

    // Dedup against an existing study (by name+client). If it exists, just
    // top up the user attribution set.
    const { rows: exRows } = await query(
      `SELECT * FROM transactions
        WHERE kind = 'study' AND client_id = $1 AND name = $2 LIMIT 1`,
      [primaryClientId, title],
    );
    const existing = camelize(exRows[0]);
    if (existing) {
      skippedDup++;
      if (!dryRun) {
        const { rows: tuRows } = await query(
          'SELECT client_user_id FROM transaction_users WHERE transaction_id = $1',
          [existing.id],
        );
        const have = new Set(tuRows.map(r => r.client_user_id));
        const toAdd = usersForThisStudy.filter(u => !have.has(u.id));
        if (toAdd.length) {
          await addTxUsers(existing.id, toAdd.map(u => u.id));
          usersAdded += toAdd.length;
        }
      }
      continue;
    }

    if (!dryRun) {
      const tx = await createTransaction({
        clientId: primaryClientId,
        kind: 'study',
        name: title,
        occurredOn,
        clientUserId: usersForThisStudy[0].id,
        creditsDelta: 0,
        dollarsDelta: 0,
        actorEmail: SEED_ACTOR,
        note: NOTE,
      });
      await addTxUsers(tx.id, usersForThisStudy.map(u => u.id));
      usersAdded += usersForThisStudy.length;
    }
    inserted++;
  }

  console.log();
  console.log(`Inserted${dryRun ? ' (dry-run)' : ''}    : ${inserted}`);
  console.log(`User attributions added           : ${usersAdded}`);
  console.log(`Skipped (no non-internal user)    : ${skippedNoUser}`);
  console.log(`Skipped (user not in our DB)      : ${skippedNoMatch}`);
  console.log(`Skipped (already imported)        : ${skippedDup}`);
  if (unmatchedExamples.length) {
    console.log('\nExamples of studies whose external user isn\'t in our DB:');
    for (const e of unmatchedExamples) console.log(`  ${e}`);
  }

  // Write orphan_studies.csv — read-merge-write so we don't clobber rows
  // written by other seed scripts (seed-client-studies, etc.).
  function csvEscape(v) {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function parseCsvFile(path) {
    if (!fs.existsSync(path)) return [];
    const raw = fs.readFileSync(path, 'utf-8').replace(/^﻿/, '');
    const rows = [];
    let row = [], cur = '', inQuote = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (inQuote) {
        if (ch === '"' && raw[i+1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQuote = false;
        else cur += ch;
      } else {
        if (ch === '"') inQuote = true;
        else if (ch === ',') { row.push(cur); cur = ''; }
        else if (ch === '\n') { row.push(cur); rows.push(row); row=[]; cur=''; }
        else if (ch !== '\r') cur += ch;
      }
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  const cols = ['reason', 'study_id', 'title', 'description', 'created_at', 'candidate_email', 'candidate_domain'];
  // Load existing rows (if any) so other sources' orphans aren't clobbered.
  const existingRows = parseCsvFile(ORPHAN_CSV);
  const existing = [];
  if (existingRows.length > 0) {
    const hdr = existingRows[0].map(s => s.replace(/^﻿/, ''));
    for (const r of existingRows.slice(1)) {
      if (!r.some(v => (v || '').trim() !== '')) continue;
      const o = {};
      hdr.forEach((h, i) => { o[h] = r[i] || ''; });
      for (const c of cols) if (!(c in o)) o[c] = '';
      existing.push(o);
    }
  }
  // Replace just the rows this script owns (those reasons), keep the rest.
  const ourReasons = new Set(['no_external_user', 'external_user_not_in_db']);
  const merged = existing
    .filter(o => !ourReasons.has(o.reason))
    .concat(orphans);
  merged.sort((a, b) => {
    if (a.reason !== b.reason) return a.reason.localeCompare(b.reason);
    if ((a.candidate_domain || '') !== (b.candidate_domain || ''))
      return (a.candidate_domain || '').localeCompare(b.candidate_domain || '');
    return (a.title || '').localeCompare(b.title || '');
  });
  const lines = [cols.join(',')];
  for (const o of merged) lines.push(cols.map(c => csvEscape(o[c])).join(','));
  fs.writeFileSync(ORPHAN_CSV, lines.join('\n') + '\n');
  console.log(`\nOrphan file: ${existing.length} previous + ${orphans.length} this run = ${merged.length} total in ${ORPHAN_CSV}`);
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
