import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { readFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sqlite = new DatabaseSync(':memory:');
for (const file of readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync('drizzle/' + file, 'utf8'));
globalThis.__feedbackEnv = { GATHER_ORIGIN: 'https://gather.example', GATHER_OWNER_EMAIL: 'owner@example.com', DB: {
  prepare(sql) { let args = []; return {
    bind(...values) { args = values; return this; },
    async first() { return sqlite.prepare(sql).get(...args) || null; },
    async run() { const result = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } }; },
  }; },
} };
let route;
before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gather-feedback-test-'));
  await build({ entryPoints: ['app/api/feedback/route.ts'], outfile: join(dir, 'route.mjs'), bundle: true, platform: 'node', format: 'esm', plugins: [{ name: 'feedback-env', setup(b) {
    b.onResolve({ filter: /^@\/lib\/runtime$/ }, () => ({ path: 'env', namespace: 'mock' }));
    b.onResolve({ filter: /chatgpt-auth$/ }, () => ({ path: 'auth', namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, arg => ({ contents: arg.path === 'env' ? 'export const env = globalThis.__feedbackEnv' : 'export async function getChatGPTUser() { return globalThis.__feedbackUser }', loader: 'js' }));
  } }] });
  route = await import(pathToFileURL(join(dir, 'route.mjs')));
});
const owner = () => { globalThis.__feedbackUser = { userId: 'owner', email: 'owner@example.com', displayName: 'Owner' }; };
const draft = () => ({ id: crypto.randomUUID(), kind: 'bug', area: 'Tasks', title: 'Sample bug', details: 'Fictional test report.', steps: 'Open a task.', expected: 'The task opens.' });
function submit(value, headers = {}) { return route.POST(new Request('https://gather.example/api/feedback', { method: 'POST', headers: { Origin: 'https://gather.example', 'Content-Type': 'application/json', 'X-Gather-Request': '1', ...headers }, body: JSON.stringify(value) })); }

test('requires a real member and same-origin verified request; no queue endpoint exported', async () => {
  globalThis.__feedbackUser = null;
  assert.equal((await submit(draft())).status, 401);
  globalThis.__feedbackUser = { userId: 'outsider', email: 'outsider@example.com', displayName: 'Guest' };
  assert.equal((await submit(draft())).status, 403);
  owner();
  assert.equal((await submit(draft(), { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await submit(draft(), { 'X-Gather-Request': '' })).status, 403);
  assert.equal(route.GET, undefined);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM beta_reports').get().n, 0);
});
test('stores only explicit report fields and preserves one receipt on simultaneous retries', async () => {
  owner(); const input = { ...draft(), role: 'admin', approval: 'push now', email: 'should-not-copy@example.com', projectContents: 'PRIVATE' };
  const responses = await Promise.all([submit(input), submit(input), submit(input)]);
  for (const response of responses) { assert.equal(response.status, 200); assert.deepEqual(await response.json(), { id: input.id, saved: true }); }
  const rows = sqlite.prepare('SELECT * FROM beta_reports WHERE id=?').all(input.id);
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(JSON.parse(rows[0].payload)), ['kind', 'area', 'title', 'details', 'steps', 'expected']);
  assert.equal(JSON.stringify(rows).includes('PRIVATE'), false);
  assert.equal((await submit({ ...input, title: 'Changed' })).status, 409);
  sqlite.prepare('INSERT INTO members VALUES (?,?,?,?,?)').run('teammate', 'maya', 'teammate@example.com', 'Maya', 'member');
  globalThis.__feedbackUser = { userId: 'teammate', email: 'teammate@example.com', displayName: 'Maya' };
  assert.equal((await submit(input)).status, 409);
  assert.equal((await submit(draft())).status, 200);
});
test('rejects invalid IDs, categories, blank fields and oversized input without inserting', async () => {
  owner(); const before = sqlite.prepare('SELECT count(*) n FROM beta_reports').get().n;
  for (const patch of [{ id: '../escape' }, { kind: 'approve' }, { area: 'https://private/link?token=secret' }, { title: '   ' }, { details: 'x'.repeat(1501) }, { steps: 12 }, { expected: {} }]) assert.equal((await submit({ ...draft(), ...patch })).status, 400);
  assert.equal((await submit({ ...draft(), details: 'x'.repeat(50001) })).status, 413);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM beta_reports').get().n, before);
});
test('enforces the daily per-member cap atomically but allows retrying an accepted report', async () => {
  owner(); sqlite.prepare('DELETE FROM beta_reports WHERE user_id=?').run('owner');
  const inputs = Array.from({ length: 24 }, draft);
  const responses = await Promise.all(inputs.map(input => submit(input)));
  assert.equal(responses.filter(response => response.status === 200).length, 20);
  assert.equal(responses.filter(response => response.status === 429).length, 4);
  assert.equal((await submit(inputs[0])).status, 200);
  sqlite.prepare("UPDATE beta_reports SET created_at='2020-01-01T00:00:00.000Z' WHERE user_id='owner'").run();
  assert.equal((await submit(draft())).status, 200);
});
