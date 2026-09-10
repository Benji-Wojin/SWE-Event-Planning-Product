import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { readFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sqlite = new DatabaseSync(':memory:');
for (const name of readdirSync('drizzle')
  .filter((n) => n.endsWith('.sql'))
  .sort())
  sqlite.exec(readFileSync('drizzle/' + name, 'utf8'));
const db = {
  async batch(statements) {
    sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const stmt of statements) results.push(await stmt.run());
      sqlite.exec('COMMIT');
      return results;
    } catch (e) {
      sqlite.exec('ROLLBACK');
      throw e;
    }
  },
  prepare(sql) {
    let args = [];
    return {
      bind(...values) {
        args = values;
        return this;
      },
      async first() {
        return sqlite.prepare(sql).get(...args) || null;
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...args) };
      },
      async run() {
        const result = sqlite.prepare(sql).run(...args);
        return { meta: { changes: Number(result.changes) } };
      },
    };
  },
};
globalThis.__gatherEnv = {
  DB: db,
  GATHER_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  GATHER_OWNER_EMAIL: 'owner@example.com',
  GATHER_ORIGIN: 'https://gather.example',
};
globalThis.__gatherUser = null;
let workspace, privateApi, gmailApi, security, gmailCore;
before(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gather-server-test-'));
  await build({
    entryPoints: {
      workspace: 'app/api/workspace/route.ts',
      private: 'app/api/private/[action]/route.ts',
      gmail: 'app/api/gmail/[action]/route.ts',
      security: 'lib/security.ts',
      gmailCore: 'lib/gmail.ts',
    },
    outdir: directory,
    bundle: true,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'test-environment',
        setup(b) {
          b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({
            path: 'env',
            namespace: 'test',
          }));
          b.onResolve({ filter: /chatgpt-auth$/ }, () => ({
            path: 'auth',
            namespace: 'test',
          }));
          b.onLoad({ filter: /.*/, namespace: 'test' }, (a) => ({
            contents:
              a.path === 'env'
                ? 'export const env=globalThis.__gatherEnv;'
                : 'export async function getChatGPTUser(){return globalThis.__gatherUser;}',
            loader: 'js',
          }));
        },
      },
    ],
  });
  [workspace, privateApi, gmailApi, security, gmailCore] = await Promise.all(
    ['workspace', 'private', 'gmail', 'security', 'gmailCore'].map(
      (name) => import(pathToFileURL(join(directory, name + '.js'))),
    ),
  );
});
const owner = () => {
  globalThis.__gatherUser = {
    userId: 'owner-1',
    email: 'owner@example.com',
    displayName: 'Owner',
  };
};
const request = (path, data, origin = 'https://gather.example') =>
  new Request('https://gather.example' + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gather-Request': '1',
      Origin: origin,
    },
    body: JSON.stringify(data),
  });
test('connection CAS cannot resurrect disconnected tokens or revert a changed label', async () => {
  const userId = 'race-user';
  await db
    .prepare(
      'INSERT INTO gmail_connections (user_id,payload,generation) VALUES (?,?,?)',
    )
    .bind(
      userId,
      await security.seal(
        { labelId: 'old', accessToken: 'token' },
        'gmail:' + userId,
      ),
      'generation-a',
    )
    .run();
  const stale = await gmailCore.connection(userId);
  await gmailCore.saveConnection(userId, { ...stale, labelId: 'new' }, true);
  await assert.rejects(
    gmailCore.saveConnection(userId, { ...stale, accessToken: 'delayed' }),
  );
  assert.equal((await gmailCore.connection(userId)).labelId, 'new');
  const current = await gmailCore.connection(userId);
  await db
    .prepare('DELETE FROM gmail_connections WHERE user_id=?')
    .bind(userId)
    .run();
  await assert.rejects(gmailCore.saveConnection(userId, current));
  assert.equal(await gmailCore.connection(userId), null);
});
test('anonymous APIs deny all private data', async () => {
  globalThis.__gatherUser = null;
  assert.equal((await workspace.GET()).status, 401);
  assert.equal(
    (
      await privateApi.GET(
        new Request('https://gather.example/api/private/records'),
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await gmailApi.GET(
        new Request('https://gather.example/api/gmail/messages'),
      )
    ).status,
    401,
  );
});
test('signed-in outsider cannot bootstrap membership', async () => {
  globalThis.__gatherUser = {
    userId: 'outsider',
    email: 'other@example.com',
    displayName: 'Other',
  };
  assert.equal((await workspace.GET()).status, 403);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM members').get().n, 0);
});
test('owner receives server workspace and real identity', async () => {
  owner();
  const response = await workspace.GET();
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.identity.actorId, 'jack');
  assert.equal(data.state.members[0].name, 'Owner');
  assert.equal(data.state.tasks.length, 12);
});
test('CSRF and actor injection are rejected', async () => {
  owner();
  let snapshot = await (await workspace.GET()).json();
  const args = {
    method: 'addTask',
    args: [{ title: 'Unsafe' }, 'maya'],
    revision: snapshot.revision,
  };
  assert.equal(
    (
      await workspace.POST(
        request('/api/workspace', args, 'https://evil.example'),
      )
    ).status,
    403,
  );
  assert.equal(
    (await workspace.POST(request('/api/workspace', args))).status,
    400,
  );
  assert.equal(
    (
      await workspace.POST(
        request('/api/workspace', {
          method: 'exportState',
          args: [],
          revision: snapshot.revision,
        }),
      )
    ).status,
    400,
  );
});
test('writes persist, record trusted actor, and reject stale revisions', async () => {
  owner();
  const snapshot = await (await workspace.GET()).json();
  const data = {
    method: 'addTask',
    args: [{ title: 'Real task', owner: 'jack', status: 'todo' }],
    revision: snapshot.revision,
  };
  const response = await workspace.POST(request('/api/workspace', data));
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.result.updatedBy, 'jack');
  assert.equal(
    (await workspace.POST(request('/api/workspace', data))).status,
    409,
  );
  const reloaded = await (await workspace.GET()).json();
  assert.ok(reloaded.state.tasks.some((t) => t.title === 'Real task'));
});
test('private records encrypt at rest and never enter shared state', async () => {
  owner();
  const reference = 'TEST-SECRET-BOOKING';
  const response = await privateApi.POST(
    request('/api/private/records', {
      title: 'Test flight',
      type: 'Flight',
      reference,
    }),
  );
  assert.equal(response.status, 200);
  const row = sqlite.prepare('SELECT payload FROM private_records').get();
  assert.ok(!row.payload.includes(reference));
  const records = await (
    await privateApi.GET(
      new Request('https://gather.example/api/private/records'),
    )
  ).json();
  assert.equal(records.records[0].reference, reference);
  const shared = await (await workspace.GET()).text();
  assert.ok(!shared.includes(reference));
  assert.equal(
    (
      await privateApi.POST(
        request('/api/private/setup', { passphrase: 'ignored' }),
      )
    ).status,
    404,
  );
});
test('encryption is context-bound and detects tampering', async () => {
  const encrypted = await security.seal({ value: 'secret' }, 'a');
  assert.equal((await security.unseal(encrypted, 'a')).value, 'secret');
  await assert.rejects(security.unseal(encrypted, 'b'));
  await assert.rejects(security.unseal(encrypted.slice(0, -4) + 'AAAA', 'a'));
});
test('Gmail setup is explicit and secrets are not returned', async () => {
  owner();
  let status = await (
    await gmailApi.GET(new Request('https://gather.example/api/gmail/status'))
  ).json();
  assert.equal(status.connected, false);
  assert.equal(
    (await gmailApi.POST(request('/api/gmail/connect', {}))).status,
    409,
  );
  const config = {
    clientId: '123-test.apps.googleusercontent.com',
    clientSecret: 'test-only-secret-123',
  };
  assert.equal(
    (await gmailApi.POST(request('/api/gmail/configure', config))).status,
    200,
  );
  status = await (
    await gmailApi.GET(new Request('https://gather.example/api/gmail/status'))
  ).json();
  assert.equal(status.configured, true);
  assert.ok(!JSON.stringify(status).includes(config.clientSecret));
  assert.ok(
    !sqlite
      .prepare('SELECT payload FROM settings')
      .get()
      .payload.includes(config.clientSecret),
  );
});
test('OAuth state is bound to identity and code uses PKCE', async () => {
  owner();
  const result = await (
    await gmailApi.POST(request('/api/gmail/connect', {}))
  ).json();
  const url = new URL(result.url);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(
    url.searchParams.get('redirect_uri'),
    'https://gather.example/api/gmail/callback',
  );
  assert.equal(
    url.searchParams.get('scope'),
    'https://www.googleapis.com/auth/gmail.readonly',
  );
  const state = url.searchParams.get('state');
  const saved = sqlite
    .prepare('SELECT * FROM oauth_states WHERE id=?')
    .get(state);
  assert.equal(saved.user_id, 'owner-1');
  const cancelled = await gmailApi.GET(
    new Request(
      'https://gather.example/api/gmail/callback?state=' +
        state +
        '&error=access_denied',
    ),
  );
  assert.equal(cancelled.status, 303);
  assert.equal(
    (
      await gmailApi.GET(
        new Request(
          'https://gather.example/api/gmail/callback?state=' +
            state +
            '&error=access_denied',
        ),
      )
    ).status,
    400,
  );
});
test('Gmail review copies only explicitly approved text', async () => {
  owner();
  const secret = {
    subject: 'Private booking ABC123',
    sender: 'private@example.com',
    body: 'Confirmation SECRET123',
    receivedAt: new Date().toISOString(),
    threadId: 'thread-private',
    providerId: 'provider-1',
  };
  await db
    .prepare(
      'INSERT INTO mail_messages (id,user_id,provider_id,payload,received_at) VALUES (?,?,?,?,?)',
    )
    .bind(
      'mail-1',
      'owner-1',
      'provider-1',
      await security.seal(secret, 'mail:mail-1'),
      secret.receivedAt,
    )
    .run();
  const data = {
    id: 'mail-1',
    taskId: 'bus',
    title: 'Speaker arrival',
    summary: 'Transport is confirmed.',
    confirmShared: true,
  };
  assert.equal(
    (
      await gmailApi.POST(
        request('/api/gmail/review', { ...data, confirmShared: false }),
      )
    ).status,
    400,
  );
  assert.equal(
    (await gmailApi.POST(request('/api/gmail/review', data))).status,
    200,
  );
  const raw = await (await workspace.GET()).text();
  assert.ok(raw.includes('Transport is confirmed.'));
  for (const field of ['ABC123', 'SECRET123', 'private@example.com'])
    assert.ok(!raw.includes(field));
  const shared = JSON.parse(raw).state.messages.find(m => m.externalId === 'review:mail-1');
  assert.equal(shared.linkedTaskId, 'bus');
  const imported = await (await gmailApi.GET(new Request('https://gather.example/api/gmail/messages'))).json();
  assert.equal(imported.messages[0].sharedMessageId, shared.id);
  assert.equal(imported.messages[0].taskId, 'bus');
  assert.ok(imported.tasks.some(t => t.id === 'bus'));
});
test('private original is owner-scoped, no-store, and absent from shared exports', async () => {
  owner();
  const url = 'https://gather.example/api/gmail/original?id=mail-1';
  const response = await gmailApi.GET(new Request(url));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal((await response.json()).body, 'Confirmation SECRET123');
  assert.equal((await gmailApi.GET(new Request(url.replace('mail-1','missing')))).status,404);
  await db.prepare('INSERT INTO mail_messages (id,user_id,provider_id,payload,received_at) VALUES (?,?,?,?,?)')
    .bind('outsider-mail','outsider','other-provider',await security.seal({body:'OTHER-SECRET'},'mail:outsider-mail'),new Date().toISOString()).run();
  assert.equal((await gmailApi.GET(new Request(url.replace('mail-1','outsider-mail')))).status,404);
  globalThis.__gatherUser = null;
  assert.equal((await gmailApi.GET(new Request(url))).status,401);
  owner();
  assert.ok(!(await (await workspace.GET()).text()).includes('SECRET123'));
});
