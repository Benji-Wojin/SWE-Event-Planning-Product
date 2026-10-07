import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';

const migrationDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');
const ledger = '_weft_migrations';

export async function readMigrations(directory = migrationDirectory) {
  const names = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
  if (!names.length || names.some(name => !/^\d{4}_[a-z0-9_]+\.sql$/.test(name))) {
    throw new Error('Migration directory is empty or contains an unsupported filename.');
  }
  if (new Set(names.map(name => name.slice(0, 4))).size !== names.length) {
    throw new Error('Migration directory contains duplicate sequence numbers.');
  }
  return Promise.all(names.map(async name => {
    const source = await readFile(resolve(directory, name), 'utf8');
    const statements = source.split('--> statement-breakpoint').map(sql => sql.trim()).filter(Boolean);
    if (!statements.length) throw new Error(`Migration ${name} is empty.`);
    return { name, checksum: createHash('sha256').update(source).digest('hex'), statements };
  }));
}

/** Explicit operator action only: this is never called by an app request or build. */
export async function migrateDatabase(client, { migrations, apply = false }) {
  const tables = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
  const hasLedger = tables.rows.some(row => row.name === ledger);
  if (!hasLedger && tables.rows.length) {
    throw new Error('This database already contains tables but has no Weft migration ledger. Stop and review its backup/import history; this command only initializes an empty database.');
  }
  const applied = hasLedger
    ? (await client.execute(`SELECT name, checksum FROM ${ledger} ORDER BY name`)).rows
    : [];
  for (let index = 0; index < applied.length; index++) {
    const current = migrations[index];
    if (!current || applied[index].name !== current.name || applied[index].checksum !== current.checksum) {
      throw new Error('Applied migration history differs from this checkout. No migrations were changed.');
    }
  }
  const pending = migrations.slice(applied.length);
  if (!apply || !pending.length) return { applied: [], pending: pending.map(migration => migration.name) };
  const statements = [{ sql: `CREATE TABLE IF NOT EXISTS ${ledger} (name TEXT PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)`, args: [] }];
  const appliedAt = new Date().toISOString();
  for (const migration of pending) {
    statements.push(...migration.statements.map(sql => ({ sql, args: [] })));
    statements.push({ sql: `INSERT INTO ${ledger} (name, checksum, applied_at) VALUES (?, ?, ?)`, args: [migration.name, migration.checksum, appliedAt] });
  }
  // The schema and history records commit together, or all roll back. Concurrent runs
  // may fail on a duplicate history row; rerun to verify instead of ignoring that race.
  await client.batch(statements, 'write');
  return { applied: pending.map(migration => migration.name), pending: [] };
}

export function migrationConnection(args, environment) {
  const mode = args[0];
  if (!['--check', '--apply'].includes(mode) || args.length !== 3 || args[1] !== '--target') {
    throw new Error('Usage: node scripts/migrate-vercel.mjs --check|--apply --target <exact-database-hostname>. Requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.');
  }
  let parsed;
  try { parsed = new URL(environment.TURSO_DATABASE_URL); } catch { throw new Error('A valid TURSO_DATABASE_URL is required.'); }
  if (!['libsql:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash || !environment.TURSO_AUTH_TOKEN?.trim()) {
    throw new Error('Configure a remote TLS database URL and TURSO_AUTH_TOKEN before running migrations.');
  }
  if (parsed.hostname !== args[2]) throw new Error('The confirmed target does not match the configured database hostname. No connection was made.');
  return { apply: mode === '--apply', config: { url: parsed.href, authToken: environment.TURSO_AUTH_TOKEN, intMode: 'number' } };
}

async function main() {
  const { apply, config } = migrationConnection(process.argv.slice(2), process.env);
  const migrations = await readMigrations();
  const client = createClient(config);
  try {
    const result = await migrateDatabase(client, { migrations, apply });
    console.log(JSON.stringify(result, null, 2));
  } catch {
    // Provider errors can contain SQL, hostnames or credentials. Keep logs private by default.
    throw new Error('Database migration/check failed. No successful completion was confirmed. Check the configured target, connectivity and migration history before retrying; never edit applied migrations.');
  } finally { client.close(); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
