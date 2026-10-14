import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let api, cron, gmail, automatic, sender, senderApi, policy;
let databaseCalls = 0;
before(async () => {
  globalThis.__launchEnv = {
    GATHER_ORIGIN: 'https://weft.example',
    GMAIL_BACKGROUND_MODE: 'vercel-cron', CRON_SECRET: 'x'.repeat(40),
    get DB() { databaseCalls++; throw new Error('Launch must not touch Gmail data'); },
  };
  const directory = mkdtempSync(join(tmpdir(), 'weft-launch-policy-'));
  await build({
    entryPoints: {
      api: 'app/api/gmail/[action]/route.ts', cron: 'app/api/gmail/automatic-run/route.ts',
      gmail: 'lib/gmail.ts', automatic: 'lib/gmail-automatic.ts',
      sender: 'lib/invitation-sender.ts', senderApi: 'app/api/sender/route.ts',
      policy: 'lib/release-policy.ts',
    }, outdir: directory, outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm',
    plugins: [{ name: 'isolated-runtime-only', setup(b) {
      b.onResolve({ filter: /^@\/lib\/runtime$/ }, () => ({ path: 'runtime', namespace: 'fixture' }));
      b.onResolve({ filter: /chatgpt-auth$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ loader: 'js', contents: path === 'runtime'
        ? 'export const env=globalThis.__launchEnv;'
        : 'export async function getChatGPTUser(){return {userId:"fixture",email:"fixture@example.com",displayName:"Fixture"};}' }));
    } }],
  });
  [api, cron, gmail, automatic, sender, senderApi, policy] = await Promise.all(
    ['api', 'cron', 'gmail', 'automatic', 'sender', 'senderApi', 'policy'].map(name => import(pathToFileURL(join(directory, name + '.mjs')))),
  );
});
const request = (path, input) => new Request('https://weft.example' + path, {
  method: input ? 'POST' : 'GET',
  headers: { Origin: 'https://weft.example', 'X-Gather-Request': '1', 'Content-Type': 'application/json', Authorization: 'Bearer ' + 'x'.repeat(40) },
  ...(input ? { body: JSON.stringify(input) } : {}),
});
test('launch policy cannot be enabled with environment configuration', () => {
  process.env.GMAIL_ENABLED = 'true';
  assert.equal(policy.GMAIL_ENABLED, false);
  delete process.env.GMAIL_ENABLED;
});
test('all Gmail read and OAuth endpoints reject before database access', async () => {
  for (const action of ['status', 'labels', 'messages', 'original', 'callback', 'unknown']) {
    const response = await api.GET(request('/api/gmail/' + action + '?state=send_fixture&code=fixture'));
    assert.equal(response.status, 403, action);
  }
  for (const action of ['configure', 'connect', 'automatic', 'check', 'move', 'label', 'sync', 'review']) {
    const response = await api.POST(request('/api/gmail/' + action, { enabled: true }));
    assert.equal(response.status, 403, action);
  }
  assert.equal(databaseCalls, 0);
});
test('Gmail background jobs and sender OAuth are blocked even with configured credentials', async () => {
  for (const method of ['GET', 'POST']) {
    assert.equal((await cron[method](request('/api/gmail/automatic-run', method === 'POST' ? {} : undefined))).status, 403);
  }
  assert.equal((await senderApi.POST(request('/api/sender', { action: 'connect' }))).status, 403);
  assert.equal(databaseCalls, 0);
});
test('lower-level Gmail operations cannot refresh tokens, fetch email, or classify it', async () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; throw new Error('No external calls allowed'); };
  try {
    for (const run of [
      () => gmail.beginOAuth('fixture'), () => gmail.gmail('fixture', 'messages'),
      () => gmail.gmailWithToken('fixture', 'messages'), () => gmail.tokenRequest({}),
      () => automatic.configureAutomatic('fixture', { enabled: true }),
      () => automatic.runAutomatic('fixture'), () => automatic.runDueMailboxes(),
      () => sender.beginSenderOAuth({}), () => sender.finishSenderOAuth({}, new URL('https://weft.example/api/gmail/callback')),
      () => sender.readySender('fixture'),
    ]) await assert.rejects(run, error => error.status === 403);
    assert.equal(fetches, 0);
    assert.equal(databaseCalls, 0);
    assert.deepEqual(await sender.senderStatus('fixture'), { configured: false, connected: false, email: '' });
  } finally { globalThis.fetch = originalFetch; }
});
test('sign-in remains identity-only and launch pages do not mount Gmail connection clients', () => {
  assert.match(readFileSync('auth.ts','utf8'), /scope: 'openid email profile'/);
  for (const page of ['app/settings/page.tsx','app/mail/page.tsx']) {
    const source = readFileSync(page,'utf8');
    assert.doesNotMatch(source, /<GmailSettings|<MailInbox/);
    assert.match(source, /<EmailAccessDisabled/);
  }
});
