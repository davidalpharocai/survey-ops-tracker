// Match users from data/users.tsv to existing clients and seed ClientUsers.
//
// Strategy:
//   1. Skip internal/test domains (alpharoc.ai, occam.ai, test domains).
//   2. Look up email domain in DOMAIN_TO_CLIENT — most reliable.
//   3. Try exact (case-insensitive) company_name match against existing
//      client names.
//   4. Anything still unmatched goes to data/unmatched_users.csv with a
//      best-guess client name (or blank if nothing plausible).
//
// After matching, backfill Client.primaryContactEmail by looking up the
// matching ClientUser by name.
//
// Usage:
//   node scripts/seed-users.js
//   node scripts/seed-users.js --dry-run

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { pool, query, camelize } from '../src/lib/db.js';
import { listClients, createClientUser, updateClient } from '../src/lib/repo.js';

const SEED_ACTOR = 'seed@alpharoc.ai';
const USERS_TSV = 'data/users.tsv';
const UNMATCHED_CSV = 'data/unmatched_users.csv';

// Internal / test domains that should never become ClientUsers.
const SKIP_DOMAINS = new Set([
  'alpharoc.ai', 'occam.ai',
  'tedi.ai', 'tediredict.ai', 'tedirec.ai', 'teditest.ai',
  'testaccount.ai', 'testaccount.al', 'test.io',
  'proton.me',
]);

// company_name (lower-cased) values that mark an AlphaROC-internal user
// even when they sign in with a personal email.
const SKIP_COMPANIES = new Set(['alpharoc', 'alpha roc', 'alpharocs', 'occam ai']);

// Email domain → canonical client name (must match a Client.name in the DB)
const DOMAIN_TO_CLIENT = {
  'aarp.org': 'AARP',
  'airlines.org': 'Airlines 4 America',
  'alaskachamber.com': 'Alaska Chamber of Commerce',
  'alkeoncapital.com': 'Alkeon',
  'alliancebernstein.com': 'Alliance Bernstein',
  'apci.org': 'American Property Casualty Insurance',
  'argentum.org': 'Argentum',
  'audible.com': 'Audible',
  'audible.de': 'Audible',
  'audible.co.uk': 'Audible',
  'aventailcap.com': 'Aventail Capital',
  'bain.com': 'Bain & Company',
  'bamfunds.com': 'BAM',
  'benchmarkquality.com': 'Benchmark Senior Living (Argentum)',
  'benchstonecapital.com': 'Benchstone',
  'bermanco.com': 'Berman & Co',
  'bkcapllc.com': 'Millennium',
  'bofa.com': 'Bank of America',
  'citadel.com': 'Citadel',
  'citadelsecurities.com': 'Citadel',
  'clearpath.org': 'ClearPath',
  'coatue.com': 'Coatue',
  'deshaw.com': 'DE Shaw',
  'emcresearch.com': 'EMC Research',
  'emersoncollective.com': 'Emerson Collective',
  'exoduspoint.com': 'Exodus Point Ezra Group',
  'fire.org': 'Fire (Foundation for Individual Rights and Expression)',
  'gingrich360.com': 'Gingrich 360',
  'goldentree.com': 'GoldenTree',
  'holoceneadvisors.com': 'Holocene Advisors',
  'hurricanecap.com': 'Hurricane Capital',
  'investnewark.org': 'Newark Alliance',
  'jpmorgan.com': 'JP Morgan',
  'meridiemcapital.com': 'Meridiem',
  'mlp.com': 'Millennium',
  'nar.realtor': 'National Association of REALTORS',
  'newark-alliance.org': 'Newark Alliance',
  'npseniorliving.com': 'New Perspective Senior Living (Argentum)',
  'okstatechamber.com': 'Oklahoma Chamber',
  'oregonbusinessindustry.com': 'Oregon Business and Industry',
  'passaiccapital.com': 'Millennium',
  'planitagency.com': 'PlanIt',
  'pointstate.com': 'PointState Capital',
  'propertyownersalliance.org': "American Property Owner's Alliance",
  'rp3agency.com': 'RP3',
  'rubriccapital.com': 'Rubric Capital',
  'selectequity.com': 'Select Equity Group',
  'sema.org': 'SEMA',
  'sportclips.com': 'Sport Clips',
  'techforce.org': 'TechForce Foundation',
  'tigerglobal.com': 'Tiger Global',
  'tillerllc.com': 'Tiller LLC',
  'uk.bnpparibas.com': 'BNP Paribas',
  'us.bnpparibas.com': 'BNP Paribas',
  'uschamber.com': 'US Chamber of Commerce',
  'vikingglobal.com': 'Viking',
  'virginia.edu': 'Better Choices for Democracy',
};

// ---------- helpers ----------

function loadUsers(tsvPath) {
  const text = fs.readFileSync(tsvPath, 'utf-8');
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return [];

  const header = lines[0].split('\t');
  const idx = name => header.indexOf(name);
  const colEmail = idx('email');
  const colDomain = idx('domain');
  const colCompany = idx('company_name');
  const colName = idx('name');
  const colDisplay = idx('display_name');

  const seen = new Set();
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const email = (parts[colEmail] || '').trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({
      email,
      domain: (parts[colDomain] || '').trim().toLowerCase(),
      company_name: (parts[colCompany] || '').trim(),
      name: (parts[colName] || '').trim(),
      display_name: (parts[colDisplay] || '').trim(),
    });
  }
  return out;
}

function bestName(u) {
  if (u.name && u.name !== u.email) return u.name;
  if (u.display_name && u.display_name !== u.email) return u.display_name;
  // Fallback: derive from email local-part
  const local = u.email.split('@')[0];
  return local
    .replace(/\./g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function guessClientByCompany(company, clients) {
  if (!company) return null;
  const cl = company.toLowerCase();
  for (const c of clients) {
    if (c.name.toLowerCase() === cl) return c.name;
  }
  // Substring (either direction) — shorter side has to be at least 4 chars
  const candidates = [];
  for (const c of clients) {
    const nl = c.name.toLowerCase();
    if (cl.length >= 4 && nl.includes(cl)) {
      candidates.push([cl.length, c.name]);
    } else if (nl.length >= 4 && cl.includes(nl)) {
      candidates.push([nl.length, c.name]);
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b[0] - a[0]);
  return candidates[0][1];
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ---------- main ----------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  if (!fs.existsSync(USERS_TSV)) {
    console.error(`ERROR: ${USERS_TSV} not found.`);
    process.exit(1);
  }
  const users = loadUsers(USERS_TSV);
  console.log(`Loaded ${users.length} unique users from ${USERS_TSV}`);

  const clients = await listClients();
  const clientsByName = new Map(clients.map(c => [c.name.toLowerCase(), c]));
  console.log(`Found ${clients.length} clients in DB.`);

  // Resolve domain → client object once
  const domainToClient = new Map();
  const unknownTargets = [];
  for (const [domain, name] of Object.entries(DOMAIN_TO_CLIENT)) {
    const c = clientsByName.get(name.toLowerCase());
    if (c) domainToClient.set(domain, c);
    else unknownTargets.push(name);
  }
  if (unknownTargets.length) {
    console.log(`WARNING: ${unknownTargets.length} domain mappings point to clients not in the DB:`);
    for (const n of unknownTargets) console.log(`   - ${n}`);
  }

  let added = 0;
  let updated = 0;
  let skippedExisting = 0;
  let skippedInternal = 0;
  let companyMatched = 0;
  const unmatched = [];

  for (const u of users) {
    if (SKIP_DOMAINS.has(u.domain)) { skippedInternal++; continue; }
    if (SKIP_COMPANIES.has(u.company_name.toLowerCase().trim())) {
      skippedInternal++;
      continue;
    }

    let client = domainToClient.get(u.domain) || null;

    if (!client && u.company_name) {
      const guess = guessClientByCompany(u.company_name, clients);
      if (guess && u.company_name.trim().toLowerCase() === guess.toLowerCase()) {
        client = clientsByName.get(guess.toLowerCase()) || null;
        if (client) companyMatched++;
      }
    }

    if (!client) {
      const guess = guessClientByCompany(u.company_name, clients) || '';
      unmatched.push({
        email: u.email,
        name: bestName(u),
        company_name: u.company_name,
        domain: u.domain,
        guess_client: guess,
      });
      continue;
    }

    const display = bestName(u);
    const { rows: exRows } = await query(
      'SELECT * FROM client_users WHERE client_id = $1 AND name = $2 LIMIT 1',
      [client.id, display],
    );
    const existing = camelize(exRows[0]);

    if (existing) {
      if (!existing.email && u.email) {
        if (!dryRun) {
          await query('UPDATE client_users SET email = $1 WHERE id = $2', [
            u.email,
            existing.id,
          ]);
        }
        updated++;
      } else {
        skippedExisting++;
      }
    } else {
      if (!dryRun) {
        await createClientUser({
          clientId: client.id,
          name: display,
          email: u.email,
          createdByEmail: SEED_ACTOR,
        });
      }
      added++;
    }
  }

  // ---------- Backfill Client.primaryContactEmail ----------
  let backfilled = 0;
  for (const c of clients) {
    if (c.primaryContactEmail || !c.primaryContactName) continue;
    const { rows: cuRows } = await query(
      `SELECT * FROM client_users
        WHERE client_id = $1 AND name = $2 AND email IS NOT NULL LIMIT 1`,
      [c.id, c.primaryContactName],
    );
    const cu = camelize(cuRows[0]);
    if (cu) {
      if (!dryRun) {
        await updateClient(c.id, { primaryContactEmail: cu.email });
      }
      backfilled++;
    }
  }

  console.log();
  console.log(`Skipped (internal/test)        : ${skippedInternal}`);
  console.log(`Matched by domain              : ${users.length - skippedInternal - unmatched.length - companyMatched}`);
  console.log(`Matched by company_name        : ${companyMatched}`);
  console.log(`Added new ClientUsers          : ${added}${dryRun ? ' (dry-run)' : ''}`);
  console.log(`Updated email on existing      : ${updated}`);
  console.log(`Skipped (already had email)    : ${skippedExisting}`);
  console.log(`Backfilled primary_contact_email: ${backfilled}`);
  console.log(`Unmatched (written to CSV)     : ${unmatched.length}`);

  // Write unmatched CSV
  fs.mkdirSync(path.dirname(UNMATCHED_CSV), { recursive: true });
  unmatched.sort((a, b) =>
    a.domain === b.domain ? a.email.localeCompare(b.email) : a.domain.localeCompare(b.domain),
  );
  const csv = ['email,name,company_name,domain,guess_client']
    .concat(
      unmatched.map(r =>
        [r.email, r.name, r.company_name, r.domain, r.guess_client]
          .map(csvEscape)
          .join(','),
      ),
    )
    .join('\n');
  fs.writeFileSync(UNMATCHED_CSV, csv + '\n');
  console.log(`\nWrote ${UNMATCHED_CSV}`);
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
