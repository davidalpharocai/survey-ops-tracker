// One-shot backfill: copy each transactions.client_user_id into the
// transaction_users join table. Idempotent — the unique constraint on
// (transaction_id, client_user_id) makes re-running safe.
//
// Run order:
//   1. npm run db:init     # ensures the schema (incl. transaction_users) exists
//   2. node scripts/migrate-tx-users.js   <- this script

import process from 'node:process';
import { pool, query } from '../src/lib/db.js';

async function main() {
  const { rowCount } = await query(
    `INSERT INTO transaction_users (transaction_id, client_user_id)
     SELECT id, client_user_id FROM transactions
      WHERE client_user_id IS NOT NULL
     ON CONFLICT (transaction_id, client_user_id) DO NOTHING`,
  );
  console.log(`Backfilled ${rowCount} transaction_users rows (existing skipped).`);
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
