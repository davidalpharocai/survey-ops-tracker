// Apply db/schema.sql to the database. Idempotent — run on every boot.
// Replaces the old `prisma migrate deploy` step.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pool } from '../src/lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');

async function main() {
  const sql = readFileSync(schemaPath, 'utf8');
  await pool.query(sql);
  console.log('Schema applied from', schemaPath);
}

main()
  .catch(err => {
    console.error('Failed to apply schema:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
