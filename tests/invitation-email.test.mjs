import { before, beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Real launch policy, authorization, SQL, encryption and routes. Only identity,
// database transport and the external email service are test doubles.
const sqlite = new DatabaseSync(':memory:');
for (const file of readdirSync('drizzle').filter(n => n.endsWith('.sql')).sort()) sqlite.exec(readFileSync('drizzle/' + file, 'utf8'));
let batchTail = Promise.resolve();
const db = {
  batch(statements) {
    const next = batchTail.then(async () => {
      sqlite.exec('BEGIN');
      try {
        const result = [];
        for (const statement of statements) result.push(await statement.run());
        sqlite.exec('COMMIT'); return result;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    });
    batchTail = next.catch(() => {}); return next;
  },
  prepare(sql) {
    let values = [];
    return {
      bind(...args) { values = args; return this; },
      async first() { return sqlite.prepare(sql).get(...values) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...values) }; },
      async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; },
    };
  },
};
const fixtureEnv = {
  DB: db, GATHER_ORIGIN: 'https://weft.example', GATHER_OWNER_EMAIL: 'app-owner@example.com',
  GATHER_ENCRYPTION_KEY: Buffer.alloc(32, 17).toString('base64'),
  RESEND_API_KEY: 'fixture-only-resend-key', RESEND_EMAIL_DOMAIN: 'weft.example',
};
globalThis.__invitationEnv = fixtureEnv;
let modules, project, calls, previousFetch;
const identity = name => { globalThis.__invitationUser = { userId: name, email: name + '@example.com', displayName: name }; };
const request = (path, input, origin = 'https://weft.example') => new Request('https://weft.example' + path, {
  method: input ? 'POST' : 'GET', headers: { Origin: origin, 'X-Gather-Request': '1', 'Content-Type': 'application/json' },
  ...(input ? { body: JSON.stringify(input) } : {}),
});
before(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weft-invitation-email-'));
  const entryPoints = {
    signup: 'app/api/signup/route.ts', projects: 'app/api/projects/route.ts', team: 'app/api/team/route.ts',
    invitations: 'app/api/invitations/route.ts', gmail: 'app/api/gmail/[action]/route.ts',
    sender: 'lib/invitation-sender.ts', security: 'lib/security.ts',
  };
  await build({ entryPoints, outdir: directory, outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm',
    plugins: [{ name: 'fixture-runtime', setup(b) {
      b.onResolve({ filter: /^@\/lib\/runtime$/ }, () => ({ path: 'env', namespace: 'fixture' }));
      b.onResolve({ filter: /chatgpt-auth$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ loader: 'js', contents: path === 'env'
        ? 'export const env=globalThis.__invitationEnv;' : 'export async function getChatGPTUser(){return globalThis.__invitationUser;}' }));
    } }],
  });
  modules = Object.fromEntries(await Promise.all(Object.keys(entryPoints).map(async name => [name, await import(pathToFileURL(join(directory, name + '.mjs')))])));
});
beforeEach(async () => {
  for (const table of ['members', 'projects', 'workspaces', 'project_invites', 'project_members', 'invitation_deliveries', 'invitation_send_attempts', 'gmail_senders', 'gmail_connections', 'oauth_states', 'sender_oauth_states']) sqlite.exec('DELETE FROM ' + table);
  fixtureEnv.DB = db;
  fixtureEnv.RESEND_API_KEY = 'fixture-only-resend-key';
  fixtureEnv.RESEND_EMAIL_DOMAIN = 'weft.example';
  previousFetch = globalThis.fetch; calls = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails'); calls.push({ url, options });
    return Response.json({ id: 'fixture-email-' + calls.length });
  };
  identity('new-organizer');
  assert.equal((await modules.signup.POST(request('/api/signup', {}))).status, 200);
  const response = await modules.projects.POST(request('/api/projects', { requestId: crypto.randomUUID(), event: { name: 'QA dinner 🥗\r\nBcc: not-a-recipient@example.com' } }));
  assert.equal(response.status, 201); project = (await response.json()).id;
});
afterEach(() => { globalThis.fetch = previousFetch; fixtureEnv.DB = db; });
const write = input => modules.team.POST(request('/api/team?project=' + project, input));
const read = async () => (await modules.team.GET(request('/api/team?project=' + project))).json();
const invite = async (email = 'guest@example.com') => {
  const id = crypto.randomUUID();
  const response = await write({ action: 'invite', email, requestId: id });
  assert.equal(response.status, 200, await response.clone().text()); return id;
};
const send = id => write({ action: 'sendExistingInvite', id, senderEmail: 'invites@weft.example' });

test('new organizer invites and sends without Gmail; recipient signs up and joins', async () => {
  const id = await invite(); assert.equal(calls.length, 0);
  assert.deepEqual((await read()).sender, { configured: true, connected: true, email: 'invites@weft.example' });
  assert.equal((await send(id)).status, 200);
  const delivery = (await read()).invitations[0].delivery;
  assert.equal(delivery.status, 'sent');
  const { options } = calls[0], content = JSON.parse(options.body);
  assert.equal(options.headers.Authorization, 'Bearer fixture-only-resend-key');
  assert.match(options.headers['Idempotency-Key'], /^weft-invite\//);
  assert.deepEqual(content.to, ['guest@example.com']);
  assert.equal(content.from, 'Weft <invites@weft.example>');
  assert.equal(content.subject, 'Weft project invitation');
  assert.equal(content.reply_to, 'support@weftplan.com');
  assert.equal(content.bcc, undefined); assert.equal(content.raw, undefined);
  assert.match(content.text, /https:\/\/weft.example\/join\?invite=/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM gmail_senders').get().n, 0);
  assert.doesNotMatch(JSON.stringify(await read()), /fixture-only-resend-key/);
  identity('guest'); assert.equal((await modules.signup.POST(request('/api/signup', {}))).status, 200);
  const response = await modules.invitations.POST(request('/api/invitations', { id, action: 'accept' }));
  assert.equal(response.status, 200); assert.equal((await response.json()).projectId, project);
  assert.equal((await modules.gmail.GET(request('/api/gmail/status'))).status, 403);
});
test('one-step email invite creates the invitation and sends only once across repeated requests', async () => {
  const requestId = crypto.randomUUID();
  const input = {action:'sendInvite', email:'person@example.com', requestId, senderEmail:'invites@weft.example'};
  const responses = await Promise.all([write(input),write(input)]);
  assert.ok(responses.every(response => response.status === 200));
  assert.equal((await write(input)).status,200);
  const team = await read();
  assert.equal(team.invitations.length,1); assert.equal(team.invitations[0].id,requestId);
  assert.equal(team.invitations[0].delivery.status,'sent'); assert.equal(calls.length,1);
});
test('one-step invitation reports provider rejection and never sends if configuration is missing', async () => {
  globalThis.fetch = async () => new Response('',{status:403});
  const response = await write({action:'sendInvite', email:'person@example.com', requestId:crypto.randomUUID(), senderEmail:'invites@weft.example'});
  assert.equal(response.status,200);
  assert.equal((await response.json()).invitations[0].delivery.status,'failed');
  fixtureEnv.RESEND_API_KEY = '';
  assert.equal((await write({action:'sendInvite',email:'other@example.com',requestId:crypto.randomUUID(),senderEmail:'invites@weft.example'})).status,409);
  assert.equal((await read()).invitations.length,1);
});
test('concurrent sends and later retries dispatch only once', async () => {
  const id = await invite();
  const results = await Promise.all([send(id), send(id), send(id)]);
  assert.ok(results.every(r => r.status === 200)); await send(id);
  assert.equal(calls.length, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM invitation_send_attempts').get().n, 1);
});
test('missing provider configuration never falls back to an old Gmail grant', async () => {
  const id = await invite(); fixtureEnv.RESEND_API_KEY = '';
  sqlite.prepare('INSERT INTO gmail_senders VALUES (?,?,?)').run('new-organizer', 'old-encrypted-token', 'old-generation');
  assert.equal((await send(id)).status, 409); assert.equal(calls.length, 0);
  assert.equal((await read()).sender.connected, false);
  assert.equal((await write({ action: 'invite', email: 'another@example.com', requestId: crypto.randomUUID() })).status, 200);
});
test('uncertain sends stay non-retryable, including provider conflicts and malformed success', async () => {
  for (const mode of ['network', 'server', 'conflict', 'malformed', 'lost-receipt']) {
    const id = await invite(mode + '@example.com'); let attempts = 0;
    globalThis.fetch = async () => {
      attempts++;
      if (mode === 'network') throw new Error('timeout');
      if (mode === 'server') return new Response('', { status: 500 });
      if (mode === 'conflict') return new Response('', { status: 409 });
      if (mode === 'malformed') return Response.json({});
      fixtureEnv.DB = { ...db, prepare(sql) { const statement = db.prepare(sql); if (sql.startsWith('UPDATE invitation_deliveries SET status=?')) statement.run = async () => { throw new Error('lost receipt'); }; return statement; } };
      return Response.json({ id: 'accepted-fixture' });
    };
    await send(id); fixtureEnv.DB = db;
    sqlite.prepare('UPDATE invitation_deliveries SET attempted_at=? WHERE invite_id=?').run(Date.now() - 61000, id);
    await send(id);
    const delivery = (await read()).invitations.find(item => item.id === id).delivery;
    assert.equal(delivery.status, 'unknown', mode); assert.equal(delivery.canRetry, false); assert.equal(attempts, 1);
  }
});
test('known rejection allows explicit retry after cooldown, never automatic resend', async () => {
  const id = await invite(); globalThis.fetch = async () => new Response('', { status: 429 });
  await send(id); assert.equal((await read()).invitations[0].delivery.status, 'failed');
  assert.equal((await send(id)).status, 409);
  sqlite.prepare('UPDATE invitation_deliveries SET attempted_at=? WHERE invite_id=?').run(Date.now() - 61000, id);
  globalThis.fetch = async (url, options) => { calls.push(options); return Response.json({ id: 'retry-receipt' }); };
  assert.equal((await send(id)).status, 200); assert.equal(calls.length, 1);
});
test('cross-project, revoked, spoofed sender, cross-origin and member requests cannot send', async () => {
  const id = await invite();
  assert.equal((await write({ action: 'sendExistingInvite', id, senderEmail: 'attacker@example.com' })).status, 409);
  assert.equal((await modules.team.POST(request('/api/team?project=' + project, { action: 'sendExistingInvite', id, senderEmail: 'invites@weft.example' }, 'https://evil.example'))).status, 403);
  identity('other-organizer'); await modules.signup.POST(request('/api/signup', {}));
  assert.equal((await send(id)).status, 404);
  identity('guest'); await modules.signup.POST(request('/api/signup', {}));
  assert.equal((await modules.invitations.POST(request('/api/invitations', { id, action: 'accept' }))).status, 200);
  assert.equal((await send(id)).status, 403);
  identity('new-organizer');
  const pending = await invite('revoked@example.com');
  sqlite.prepare("UPDATE project_invites SET revoked_at='fixture' WHERE id=?").run(pending);
  assert.equal((await send(pending)).status, 409); assert.equal(calls.length, 0);
});
test('global free-plan quotas apply across organizers', async () => {
  const id = await invite();
  const insert = sqlite.prepare('INSERT INTO invitation_send_attempts VALUES (?,?,?,?)');
  for (let i = 0; i < 90; i++) insert.run('day-' + i, 'other-organizer', 'other-invite', Date.now());
  assert.equal((await send(id)).status, 409); assert.equal(calls.length, 0);
  sqlite.exec('DELETE FROM invitation_send_attempts');
  for (let i = 0; i < 2900; i++) insert.run('month-' + i, 'other-organizer', 'other-invite', Date.now() - 2 * 86400000);
  assert.equal((await send(id)).status, 409); assert.equal(calls.length, 0);
});
test('launch disconnect removes only the signed-in user Gmail tokens without network calls', async () => {
  for (const user of ['new-organizer', 'someone-else']) {
    sqlite.prepare('INSERT INTO gmail_senders VALUES (?,?,?)').run(user, 'old-token', 'old-generation');
    sqlite.prepare('INSERT INTO gmail_connections (user_id,payload) VALUES (?,?)').run(user, 'old-token');
  }
  assert.equal((await modules.gmail.POST(request('/api/gmail/disconnect', {}))).status, 200);
  for (const table of ['gmail_senders', 'gmail_connections']) {
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM ' + table + ' WHERE user_id=?').get('new-organizer').n, 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM ' + table + ' WHERE user_id=?').get('someone-else').n, 1);
  }
  assert.equal(calls.length, 0); assert.equal((await read()).sender.connected, true);
});
