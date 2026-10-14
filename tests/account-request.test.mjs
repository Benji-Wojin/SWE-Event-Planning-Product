import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

let accountRequest;
before(async () => {
  const result = await build({
    entryPoints: ['lib/account-request.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
  });
  ({ accountRequest } = await import(
    'data:text/javascript;base64,' +
      Buffer.from(result.outputFiles[0].text).toString('base64')
  ));
});

test('successful GET retains same-origin credentials, disables caching, and clears its timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let options;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, '/api/account');
    options = init;
    return Response.json({ id: 'fixture-user' });
  });
  assert.deepEqual(await accountRequest('/api/account'), {
    id: 'fixture-user',
  });
  assert.equal(options.credentials, 'same-origin');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.method, 'GET');
  assert.equal(options.body, undefined);
  t.mock.timers.tick(60_000);
  assert.equal(options.signal.aborted, false);
});

test('successful POST retains JSON and CSRF request header and sends once', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return Response.json({ created: true });
  });
  assert.deepEqual(await accountRequest('/api/signup', {}), { created: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].options.headers['X-Gather-Request'], '1');
  assert.equal(calls[0].options.body, '{}');
});

test('server errors are preserved and their timers are cleared', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    signal = options.signal;
    return Response.json({ error: 'Invitation expired.' }, { status: 410 });
  });
  await assert.rejects(
    accountRequest('/api/join', { token: 'fixture' }),
    /^Error: Invitation expired\.$/,
  );
  t.mock.timers.tick(60_000);
  assert.equal(signal.aborted, false);
});

test('a stalled read times out at 30 seconds even if fetch ignores abort', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal,
    calls = 0,
    settled = false;
  t.mock.method(globalThis, 'fetch', (_, options) => {
    calls++;
    signal = options.signal;
    return new Promise(() => {});
  });
  const request = accountRequest('/api/account');
  const checked = assert
    .rejects(request, /took too long.*Reload and try again/)
    .then(() => {
      settled = true;
    });
  t.mock.timers.tick(29_999);
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await checked;
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
});

test('a stalled body is bounded and a late success cannot change the outcome', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolveBody,
    signal,
    calls = 0;
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    calls++;
    signal = options.signal;
    return {
      ok: true,
      json: () =>
        new Promise((resolve) => {
          resolveBody = resolve;
        }),
    };
  });
  const request = accountRequest('/api/invitations', {
    action: 'accept',
    id: 'fixture',
  });
  const checked = assert.rejects(
    request,
    /may have completed.*Reload to check/,
  );
  await Promise.resolve();
  t.mock.timers.tick(30_000);
  await checked;
  assert.equal(signal.aborted, true);
  resolveBody({ projectId: 'p_fixture' });
  await assert.rejects(request, /may have completed/);
  assert.equal(calls, 1);
});

test('network failure warns a write may have completed and does not leak transport details', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    throw new Error('internal transport detail');
  });
  await assert.rejects(accountRequest('/api/signup', {}), (error) => {
    assert.match(error.message, /may have completed.*Reload to check/);
    assert.doesNotMatch(error.message, /internal transport detail/);
    return true;
  });
  assert.equal(calls, 1);
});

test('malformed response after a write also reports an uncertain outcome', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('<html>Unavailable</html>'),
  );
  await assert.rejects(
    accountRequest('/api/team', { action: 'invite' }),
    /may have completed.*Reload to check/,
  );
});
