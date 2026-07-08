// One-shot: delete every contract transaction in the DB, then create a
// single Holocene Advisors contract at $10,000 + 1,500 credits.
//
// Studies are not touched.
//
// Usage:
//   npm run reset:contracts -- --dry-run     # preview
//   npm run reset:contracts                  # actually do it

import process from 'node:process';
import { pool, query } from '../src/lib/db.js';
import {
  findClientByName,
  deleteTransactionsByKind,
  createTransaction,
} from '../src/lib/repo.js';
import { addYear } from '../src/lib/dates.js';

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const { rows } = await query(
    "SELECT COUNT(*)::int AS n FROM transactions WHERE kind = 'contract'",
  );
  console.log(`Found ${rows[0].n} existing contract transaction(s).`);

  const holocene = await findClientByName('Holocene Advisors');
  if (!holocene) {
    console.error('ERROR: Holocene Advisors client not found.');
    process.exit(1);
  }
  console.log(`Holocene Advisors id = ${holocene.id}`);

  if (dryRun) {
    console.log('\n--dry-run: would delete every contract row and insert one new Holocene contract.');
    return;
  }

  const deleted = await deleteTransactionsByKind('contract');
  console.log(`Deleted ${deleted} contracts.`);

  const today = new Date();
  const renewal = addYear(today);
  const c = await createTransaction({
    clientId: holocene.id,
    kind: 'contract',
    name: 'Holocene 2026',
    occurredOn: today,
    renewalOn: renewal,
    creditsDelta: 1500,
    dollarsDelta: 10000,
    actorEmail: 'reset@alpharoc.ai',
    note: 'Reset to $10,000 + 1,500 credits',
  });
  console.log(`Created contract #${c.id} for Holocene Advisors: $10,000 + 1,500 credits, renews ${renewal.toISOString().slice(0, 10)}.`);
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
