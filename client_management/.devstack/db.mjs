// Local dev Postgres for the CMS stack. Usage: node db.mjs start | stop
// Data persists in .devstack/pgdata; connection string matches backend/.env:
//   postgresql://postgres:dev@localhost:5433/clientcredits
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, 'pgdata');
const cmd = process.argv[2] ?? 'start';

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'dev',
  port: 5433,
  persistent: true,
});

if (cmd === 'start') {
  const fresh = !existsSync(join(dataDir, 'PG_VERSION'));
  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) await pg.createDatabase('clientcredits');
  console.log('Postgres up on port 5433 (db: clientcredits, user: postgres, pw: dev)');
  console.log('This process must stay alive; stop with: node db.mjs stop (or kill it).');
  // embedded-postgres stops the server when this process exits unless we hold on
  process.stdin.resume();
  const shutdown = async () => { await pg.stop(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} else if (cmd === 'stop') {
  await pg.stop();
  console.log('Postgres stopped.');
} else {
  console.error(`unknown command: ${cmd}`);
  process.exit(1);
}
