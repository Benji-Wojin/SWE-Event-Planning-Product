import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { build } from 'esbuild';
import { drizzle } from 'drizzle-orm/d1';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { migrateDatabase, migrationConnection, readMigrations } from '../scripts/migrate-vercel.mjs';

let createDatabase, createDatabaseFromEnvironment;
before(async () => {
  // Keep the native libSQL driver external and resolve it from this checkout.
  const output = await build({ entryPoints: ['lib/platform/database.ts'], bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false });
  const moduleSource = output.outputFiles[0].text.replace('from "@libsql/client"', `from ${JSON.stringify(import.meta.resolve('@libsql/client'))}`);
  ({ createDatabase, createDatabaseFromEnvironment } = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`));
});

async function withDatabase(run) {
  const client = createClient({ url: 'file::memory:', intMode: 'number' });
  try { await run(createDatabase(client), client); } finally { client.close(); }
}

test('Vercel SQL adapter binds safely and returns D1-shaped rows and changes', async () => withDatabase(async db => {
  await db.prepare('CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, finished INTEGER DEFAULT 0)').run();
  const prepared = db.prepare('INSERT INTO tasks (id,title) VALUES (?,?)');
  const first = prepared.bind('task-a', "Food'); DROP TABLE tasks; --");
  const second = prepared.bind('task-b', 'Transport');
  const result = await first.run();
  await second.run();
  assert.equal(result.success, true);
  assert.equal(result.meta.changes, 1);
  assert.deepEqual(await db.prepare('SELECT id,title FROM tasks ORDER BY id').all().then(result => result.results), [
    { id: 'task-a', title: "Food'); DROP TABLE tasks; --" }, { id: 'task-b', title: 'Transport' },
  ]);
  assert.equal(await db.prepare('SELECT title FROM tasks WHERE id=?').bind('task-b').first('title'), 'Transport');
  assert.equal(await db.prepare('SELECT * FROM tasks WHERE id=?').bind('missing').first(), null);
  await assert.rejects(db.prepare('SELECT title FROM tasks').first('missing'), /column/);
  assert.equal((await db.prepare('UPDATE tasks SET finished=1 WHERE id=?').bind('missing').run()).meta.changes, 0);
  for (const value of [undefined, {}, true, NaN, Infinity]) assert.throws(() => prepared.bind(value), /parameter/);
}));

test('Vercel SQL adapter raw rows preserve column order and binary bindings', async () => withDatabase(async db => {
  const bytes = new Uint8Array([1, 2, 3]);
  const prepared = db.prepare('SELECT ? AS z, ? AS a, ? AS empty').bind('last', bytes, null);
  bytes[0] = 9;
  const rows = await prepared.raw({ columnNames: true });
  assert.deepEqual(rows[0], ['z', 'a', 'empty']);
  assert.equal(rows[1][0], 'last');
  assert.deepEqual([...new Uint8Array(rows[1][1])], [1, 2, 3]);
  assert.equal(rows[1][2], null);
  assert.deepEqual(await db.prepare('SELECT 2 AS b, 1 AS a').raw(), [[2, 1]]);
}));

test('Vercel SQL batch commits atomically and rolls back every write on failure', async () => withDatabase(async (db, client) => {
  await db.prepare('CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT)').run();
  const success = await db.batch([
    db.prepare('INSERT INTO tasks VALUES (?,?)').bind('one', 'Food'),
    db.prepare('SELECT title FROM tasks WHERE id=?').bind('one'),
  ]);
  assert.equal(success[0].meta.changes, 1);
  assert.deepEqual(success[1].results, [{ title: 'Food' }]);
  await assert.rejects(db.batch([
    db.prepare('INSERT INTO tasks VALUES (?,?)').bind('two', 'Transport'),
    db.prepare('INSERT INTO tasks VALUES (?,?)').bind('one', 'Duplicate'),
  ]));
  assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM tasks').first('count'), 1);
  assert.deepEqual(await db.batch([]), []);
  const other = createClient({ url: 'file::memory:' });
  try { await assert.rejects(db.batch([createDatabase(other).prepare('SELECT 1')]), /same database/); }
  finally { other.close(); }
  await assert.rejects(db.batch([{ sql: 'SELECT 1', owner: client }]), /same database/);
}));

test('Vercel SQL adapter supports the existing Drizzle D1 wrapper', async () => withDatabase(async db => {
  await db.prepare('CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, done INTEGER)').run();
  const tasks = sqliteTable('tasks', { id: text('id').primaryKey(), title: text('title'), done: integer('done', { mode: 'boolean' }) });
  const orm = drizzle(db);
  await orm.insert(tasks).values({ id: 'fixture', title: 'Confirm venue', done: false });
  assert.deepEqual(await orm.select().from(tasks), [{ id: 'fixture', title: 'Confirm venue', done: false }]);
  const results = await orm.batch([orm.update(tasks).set({ done: true }), orm.select().from(tasks)]);
  assert.deepEqual(results[1], [{ id: 'fixture', title: 'Confirm venue', done: true }]);
}));

test('Vercel SQL adapter preserves workspace compare-and-swap and SQLite JSON operations', async () => withDatabase(async db => {
  await db.prepare('CREATE TABLE workspaces (id TEXT PRIMARY KEY, data TEXT NOT NULL, revision INTEGER NOT NULL)').run();
  await db.prepare('INSERT OR IGNORE INTO workspaces VALUES (?,?,?)').bind('fictional-project', '{"tasks":["venue"]}', 1).run();
  const update = db.prepare('UPDATE workspaces SET data=?, revision=revision+1 WHERE id=? AND revision=?');
  assert.equal((await update.bind('{"tasks":["venue","food"]}', 'fictional-project', 1).run()).meta.changes, 1);
  assert.equal((await update.bind('{"tasks":[]}', 'fictional-project', 1).run()).meta.changes, 0);
  assert.equal(await db.prepare("SELECT json_array_length(data,'$.tasks') AS count FROM workspaces WHERE id=?").bind('fictional-project').first('count'), 2);
  assert.deepEqual((await db.prepare('UPDATE workspaces SET revision=revision+1 WHERE id=? RETURNING revision').bind('fictional-project').all()).results, [{ revision: 3 }]);
}));

test('Vercel SQL runtime requires remote TLS configuration and never falls back to local disk', () => {
  for (const config of [{}, { TURSO_DATABASE_URL: 'file:local.db', TURSO_AUTH_TOKEN: 'fixture' }, { TURSO_DATABASE_URL: 'http://example.com', TURSO_AUTH_TOKEN: 'fixture' }, { TURSO_DATABASE_URL: 'libsql://fixture.turso.io' }, { TURSO_DATABASE_URL: 'libsql://secret@fixture.turso.io', TURSO_AUTH_TOKEN: 'fixture' }]) {
    assert.throws(() => createDatabaseFromEnvironment(config), /not configured/);
  }
});

test('Vercel migration runner applies existing schema atomically and retries without duplicate changes', async () => withDatabase(async (db, client) => {
  const migrations = await readMigrations();
  const pending = await migrateDatabase(client, { migrations });
  assert.equal(pending.pending.length, migrations.length);
  assert.equal((await client.execute("SELECT name FROM sqlite_master WHERE name='_weft_migrations'")).rows.length, 0);
  assert.equal((await migrateDatabase(client, { migrations, apply: true })).applied.length, migrations.length);
  assert.deepEqual(await migrateDatabase(client, { migrations, apply: true }), { applied: [], pending: [] });
  assert.ok((await db.prepare("PRAGMA table_info('gmail_connections')").all()).results.some(row => row.name === 'generation'));
  assert.equal((await client.execute('SELECT COUNT(*) AS count FROM members')).rows[0].count, 0);
  assert.equal((await client.execute('SELECT COUNT(*) AS count FROM plan_drafts')).rows[0].count, 0);
  await assert.rejects(migrateDatabase(client, { migrations: [{ ...migrations[0], checksum: 'changed' }, ...migrations.slice(1)], apply: true }), /history differs/);
  await assert.rejects(migrateDatabase(client, { migrations: migrations.slice(0, -1), apply: true }), /history differs/);
}));

test('Vercel migration runner fails closed for unknown existing data and partial failures', async () => withDatabase(async (db, client) => {
  const migrations = [{ name: '0000_fixture.sql', checksum: 'fixture', statements: ['CREATE TABLE fixture (id TEXT PRIMARY KEY)', 'THIS IS INVALID SQL'] }];
  await assert.rejects(migrateDatabase(client, { migrations, apply: true }));
  assert.deepEqual((await client.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows, []);
  await db.prepare('CREATE TABLE existing_data (id TEXT)').run();
  await assert.rejects(migrateDatabase(client, { migrations, apply: true }), /already contains tables/);
  assert.equal((await client.execute("SELECT name FROM sqlite_master WHERE name='existing_data'")).rows.length, 1);
}));

test('Vercel migration CLI requires an explicit matching target and apply flag', () => {
  const config = { TURSO_DATABASE_URL: 'libsql://fixture.turso.io', TURSO_AUTH_TOKEN: 'fixture-only' };
  assert.throws(() => migrationConnection([], config), /Usage/);
  assert.throws(() => migrationConnection(['--apply', '--target', 'other.turso.io'], config), /does not match/);
  assert.throws(() => migrationConnection(['--apply', '--target', 'fixture.turso.io'], { ...config, TURSO_AUTH_TOKEN: '' }), /Configure/);
  assert.equal(migrationConnection(['--check', '--target', 'fixture.turso.io'], config).apply, false);
  assert.equal(migrationConnection(['--apply', '--target', 'fixture.turso.io'], config).apply, true);
});
