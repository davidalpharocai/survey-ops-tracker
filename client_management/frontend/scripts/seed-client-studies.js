// Import studies recorded in two ad-hoc sources:
//
//   data/client_study_surveys.csv
//     Columns: client, study, survey_ids
//     `client` is free-text and may include " - <user hint>" (e.g.
//     "BAM - Grey Jones"). `survey_ids` is a comma-separated string.
//
//   data/edwin_unregistered_survey_ids.txt
//     One survey ID per line — these are EdWIN surveys that aren't yet
//     associated with a study/client. They go straight to orphan_studies.csv.
//
// What we do:
//   - For each client_study row, resolve the client name (with a small
//     alias map for the abbreviated names in this file), optionally
//     resolve the user hint to a ClientUser, and insert one
//     Transaction(kind='study', cost=0). If the client doesn't resolve,
//     dump the row to orphan_studies.csv with reason='client_not_matched'.
//   - For each edwin ID, append a row to orphan_studies.csv with
//     reason='edwin_unregistered'.
//   - The orphan file is loaded first, merged with new rows, deduped on
//     (reason, study_id), and written back. So re-running is idempotent.
//
// Usage:
//   npm run seed:client-studies
//   npm run seed:client-studies -- --dry-run

import fs from 'node:fs';
import process from 'node:process';

import { pool, query, camelize } from '../src/lib/db.js';
import {
  listClients,
  listClientUsersByClient,
  createTransaction,
} from '../src/lib/repo.js';

const CLIENT_STUDIES_CSV = 'data/client_study_surveys.csv';
const EDWIN_TXT = 'data/edwin_unregistered_survey_ids.txt';
const ORPHAN_CSV = 'data/orphan_studies.csv';
const SEED_ACTOR = 'seed@alpharoc.ai';

// Lower-case alias → canonical Client.name in our DB
const CLIENT_ALIASES = {
  'bam': 'BAM',
  'coatue': 'Coatue',
  'emc': 'EMC Research',
  'holocene': 'Holocene Advisors',
  'techforce': 'TechForce Foundation',
};

const ORPHAN_COLS = [
  'reason', 'study_id', 'title', 'description',
  'created_at', 'candidate_email', 'candidate_domain',
];

// ---------- helpers ----------

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

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function parseClientField(raw) {
  // "BAM - Grey Jones" -> { clientName: "BAM", userHint: "Grey Jones" }
  const t = (raw || '').trim();
  const idx = t.indexOf(' - ');
  if (idx === -1) return { clientName: t, userHint: null };
  return {
    clientName: t.slice(0, idx).trim(),
    userHint: t.slice(idx + 3).trim() || null,
  };
}

function resolveClient(name, dbClients) {
  if (!name) return null;
  const lower = name.toLowerCase();
  const aliasName = CLIENT_ALIASES[lower];
  if (aliasName) {
    const c = dbClients.find(c => c.name === aliasName);
    if (c) return c;
  }
  return dbClients.find(c => c.name.toLowerCase() === lower) || null;
}

// Try to extract a date from any of the survey IDs (YYYYMMDD or YYYYMM patterns).
function dateFromSurveyIds(ids) {
  for (const id of ids) {
    const d8 = id.match(/(\d{4})(\d{2})(\d{2})/);
    if (d8) {
      const dt = new Date(Date.UTC(+d8[1], +d8[2] - 1, +d8[3]));
      if (!Number.isNaN(dt.getTime()) && dt.getUTCFullYear() >= 2020 && dt.getUTCFullYear() <= 2030) {
        return dt;
      }
    }
    const d6 = id.match(/(\d{4})(\d{2})(?!\d)/);
    if (d6) {
      const dt = new Date(Date.UTC(+d6[1], +d6[2] - 1, 1));
      if (!Number.isNaN(dt.getTime()) && dt.getUTCFullYear() >= 2020 && dt.getUTCFullYear() <= 2030) {
        return dt;
      }
    }
  }
  return null;
}

function loadOrphans(path) {
  if (!fs.existsSync(path)) return [];
  const text = fs.readFileSync(path, 'utf-8').replace(/^﻿/, '');
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0].map(s => s.replace(/^﻿/, ''));
  return rows
    .slice(1)
    .filter(r => r.some(v => (v || '').trim() !== ''))
    .map(r => {
      const o = {};
      for (let i = 0; i < header.length; i++) o[header[i]] = r[i] || '';
      // Backfill any missing columns
      for (const c of ORPHAN_COLS) if (!(c in o)) o[c] = '';
      return o;
    });
}

function writeOrphans(path, rows) {
  rows.sort((a, b) => {
    if (a.reason !== b.reason) return a.reason.localeCompare(b.reason);
    return a.study_id.localeCompare(b.study_id);
  });
  const lines = [ORPHAN_COLS.join(',')];
  for (const o of rows) lines.push(ORPHAN_COLS.map(c => csvEscape(o[c] || '')).join(','));
  fs.writeFileSync(path, lines.join('\n') + '\n');
}

// ---------- main ----------

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (!fs.existsSync(CLIENT_STUDIES_CSV) || !fs.existsSync(EDWIN_TXT)) {
    console.error(
      `ERROR: missing ${CLIENT_STUDIES_CSV} or ${EDWIN_TXT}.`
    );
    process.exit(1);
  }

  const csvRows = parseCsv(
    fs.readFileSync(CLIENT_STUDIES_CSV, 'utf-8').replace(/^﻿/, ''),
  );
  const csvHeader = csvRows[0].map(s => s.replace(/^﻿/, ''));
  const csvData = csvRows
    .slice(1)
    .filter(r => r.some(v => (v || '').trim() !== ''))
    .map(r => Object.fromEntries(csvHeader.map((h, i) => [h, r[i] || ''])));

  const edwinIds = fs
    .readFileSync(EDWIN_TXT, 'utf-8')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  console.log(`Loaded ${csvData.length} rows from ${CLIENT_STUDIES_CSV}`);
  console.log(`Loaded ${edwinIds.length} unregistered survey IDs from ${EDWIN_TXT}`);

  const dbClients = await listClients();

  // Cache user lookups per client
  const usersCache = new Map();
  async function usersForClient(clientId) {
    if (usersCache.has(clientId)) return usersCache.get(clientId);
    const us = await listClientUsersByClient(clientId);
    usersCache.set(clientId, us);
    return us;
  }
  function findUser(users, hint) {
    if (!hint) return null;
    const lower = hint.toLowerCase();
    return (
      users.find(u => u.name.toLowerCase() === lower) ||
      users.find(u => u.name.toLowerCase().includes(lower)) ||
      null
    );
  }

  let inserted = 0;
  let skippedDup = 0;
  const newOrphans = [];
  const inserts = []; // for dry-run preview

  for (const row of csvData) {
    if (!row.client) continue;
    const { clientName, userHint } = parseClientField(row.client);
    const studyName = (row.study || '').trim();
    const surveyIds = (row.survey_ids || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const client = resolveClient(clientName, dbClients);
    if (!client) {
      newOrphans.push({
        reason: 'client_not_matched',
        study_id: surveyIds[0] || '',
        title: studyName,
        description: `Client raw: ${row.client}; survey_ids: ${surveyIds.join(',')}`,
        created_at: '',
        candidate_email: '',
        candidate_domain: '',
      });
      continue;
    }

    const users = await usersForClient(client.id);
    const cu = findUser(users, userHint);

    const occurredOn = dateFromSurveyIds(surveyIds) || new Date();

    const { rows: exRows } = await query(
      `SELECT id FROM transactions
        WHERE kind = 'study' AND client_id = $1 AND name = $2 LIMIT 1`,
      [client.id, studyName],
    );
    if (exRows[0]) { skippedDup++; continue; }

    inserts.push({
      client: client.name,
      user: cu ? cu.name : null,
      study: studyName,
      occurredOn,
      surveyIds,
    });

    if (!dryRun) {
      await createTransaction({
        clientId: client.id,
        kind: 'study',
        name: studyName,
        occurredOn,
        clientUserId: cu ? cu.id : null,
        creditsDelta: 0,
        dollarsDelta: 0,
        actorEmail: SEED_ACTOR,
        note:
          `From client_study_surveys.csv; surveys: ${surveyIds.join(', ')}; ` +
          `cost not recorded`,
      });
    }
    inserted++;
  }

  // EdWIN unregistered IDs → orphans
  for (const id of edwinIds) {
    newOrphans.push({
      reason: 'edwin_unregistered',
      study_id: id,
      title: '',
      description: 'EdWIN unregistered survey ID',
      created_at: '',
      candidate_email: '',
      candidate_domain: '',
    });
  }

  // Read existing orphans, merge, dedupe
  const existingOrphans = loadOrphans(ORPHAN_CSV);
  const seen = new Set(
    existingOrphans.map(o => `${o.reason}|${o.study_id}`),
  );
  const truNew = newOrphans.filter(o => !seen.has(`${o.reason}|${o.study_id}`));
  const merged = existingOrphans.concat(truNew);

  console.log();
  console.log(`From ${CLIENT_STUDIES_CSV}:`);
  console.log(`  Inserted${dryRun ? ' (dry-run)' : ''} : ${inserted}`);
  console.log(`  Skipped (already imported)        : ${skippedDup}`);
  console.log(`  Orphan (client not matched)       : ${newOrphans.filter(o => o.reason === 'client_not_matched').length}`);
  console.log();
  console.log(`From ${EDWIN_TXT}:`);
  console.log(`  Orphan (edwin_unregistered)       : ${newOrphans.filter(o => o.reason === 'edwin_unregistered').length}`);
  console.log();
  console.log(`Orphan file: ${existingOrphans.length} existing rows + ${truNew.length} new = ${merged.length} total`);

  if (inserts.length) {
    console.log('\nInserts:');
    for (const i of inserts) {
      const dateStr = i.occurredOn.toISOString().slice(0, 10);
      console.log(
        `  ${i.client.padEnd(22)} ${i.user ? '/ ' + i.user.padEnd(15) : ''.padEnd(18)} ${dateStr}  "${i.study}"`,
      );
    }
  }

  if (!dryRun) {
    writeOrphans(ORPHAN_CSV, merged);
    console.log(`\nWrote ${ORPHAN_CSV}`);
  }
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
