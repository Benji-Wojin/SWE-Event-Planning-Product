import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

let env, createPrivateBucket;
const keys = [
  'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'BLOB_READ_WRITE_TOKEN', 'BLOB_STORE_ID',
  'GATHER_ORIGIN', 'GATHER_OWNER_EMAIL', 'GATHER_ENCRYPTION_KEY',
  'GROQ_API_KEY', 'GROQ_WEB_SEARCH_ENABLED', 'GMAIL_BACKGROUND_MODE', 'CRON_SECRET',
];
const originalEnvironment = new Map(keys.map(key => [key, process.env[key]]));
const objects = new Map();
const calls = [];
const fileKey = 'project-files/00000000-0000-4000-8000-000000000001';
let databaseCalls = 0;
const database = { prepare() {} };

before(async () => {
  for (const key of keys) delete process.env[key];
  globalThis.__weftCreateDatabase = environment => {
    databaseCalls++;
    assert.equal(environment.TURSO_DATABASE_URL, 'libsql://fictional.example');
    assert.equal(environment.TURSO_AUTH_TOKEN, 'fictional-database-token');
    return database;
  };
  globalThis.__weftBlobSdk = {
    async put(key, bytes, options) {
      calls.push({ method: 'put', key, options });
      objects.set(key, new Uint8Array(bytes).slice());
    },
    async get(key, options) {
      calls.push({ method: 'get', key, options });
      const bytes = objects.get(key);
      return bytes ? { statusCode: 200, stream: new Response(bytes).body } : null;
    },
    async del(key, options) {
      calls.push({ method: 'delete', key, options });
      objects.delete(key);
    },
  };
  const directory = mkdtempSync(join(tmpdir(), 'weft-runtime-test-'));
  await build({
    entryPoints: { runtime: 'lib/runtime.ts', blob: 'lib/platform/blob.ts' },
    outdir: directory,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    plugins: [{
      name: 'isolated-providers',
      setup(b) {
        b.onResolve({ filter: /^server-only$/ }, () => ({ path: 'server', namespace: 'fixture' }));
        b.onResolve({ filter: /^@vercel\/blob$/ }, () => ({ path: 'blob', namespace: 'fixture' }));
        b.onResolve({ filter: /platform\/database$/ }, () => ({ path: 'database', namespace: 'fixture' }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents: path === 'server' ? '' : path === 'database'
            ? 'export const createDatabaseFromEnvironment = (...args) => globalThis.__weftCreateDatabase(...args);'
            : 'export const put = (...args) => globalThis.__weftBlobSdk.put(...args); export const get = (...args) => globalThis.__weftBlobSdk.get(...args); export const del = (...args) => globalThis.__weftBlobSdk.del(...args);',
          loader: 'js',
        }));
      },
    }],
  });
  ({ env } = await import(pathToFileURL(join(directory, 'runtime.mjs'))));
  ({ createPrivateBucket } = await import(pathToFileURL(join(directory, 'blob.mjs'))));
});

after(() => {
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  delete globalThis.__weftBlobSdk;
  delete globalThis.__weftCreateDatabase;
});

test('runtime imports without credentials and does not connect during build', () => {
  assert.equal(databaseCalls, 0);
  assert.equal(calls.length, 0);
  assert.equal(env.BUCKET, undefined);
  assert.equal(env.GATHER_ORIGIN, '');
  assert.equal(env.GATHER_OWNER_EMAIL, '');
  assert.equal(env.GATHER_ENCRYPTION_KEY, '');
  assert.equal(env.GROQ_API_KEY, undefined);
  assert.equal(env.GMAIL_BACKGROUND_MODE, undefined);
  assert.equal(env.CRON_SECRET, undefined);
});

test('database is initialized lazily once with server-only credentials', () => {
  process.env.TURSO_DATABASE_URL = 'libsql://fictional.example';
  process.env.TURSO_AUTH_TOKEN = 'fictional-database-token';
  assert.equal(env.DB, database);
  assert.equal(env.DB, database);
  assert.equal(databaseCalls, 1);
});

test('runtime reads explicit configuration, with no automatic AI or background opt-in', () => {
  process.env.GATHER_ORIGIN = 'https://weft.example';
  process.env.GATHER_OWNER_EMAIL = 'owner@example.com';
  process.env.GATHER_ENCRYPTION_KEY = 'fictional-key';
  process.env.GROQ_API_KEY = 'fictional-groq';
  process.env.GROQ_WEB_SEARCH_ENABLED = 'false';
  assert.equal(env.GATHER_ORIGIN, 'https://weft.example');
  assert.equal(env.GATHER_OWNER_EMAIL, 'owner@example.com');
  assert.equal(env.GATHER_ENCRYPTION_KEY, 'fictional-key');
  assert.equal(env.GROQ_API_KEY, 'fictional-groq');
  assert.equal(env.GROQ_WEB_SEARCH_ENABLED, 'false');
  assert.equal(env.GMAIL_BACKGROUND_MODE, undefined);
  assert.equal(env.CRON_SECRET, undefined);
});

test('encrypted uploads use private Blob access, exact keys, no overwrites and authenticated reads/deletes', async () => {
  process.env.BLOB_READ_WRITE_TOKEN = 'fictional-private-storage-token';
  const bucket = env.BUCKET;
  assert.ok(bucket);
  assert.equal(bucket, env.BUCKET);
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  await bucket.put(fileKey, bytes, { httpMetadata: { contentType: 'application/octet-stream' } });
  assert.deepEqual(calls.at(-1), {
    method: 'put', key: fileKey,
    options: {
      token: 'fictional-private-storage-token', access: 'private',
      addRandomSuffix: false, allowOverwrite: false, contentType: 'application/octet-stream',
    },
  });
  const stored = await bucket.get(fileKey);
  assert.deepEqual(new Uint8Array(await stored.arrayBuffer()), new Uint8Array(bytes));
  assert.deepEqual(calls.at(-1).options, { token: 'fictional-private-storage-token', access: 'private' });
  await bucket.delete(fileKey);
  assert.equal(calls.at(-1).options.token, 'fictional-private-storage-token');
  assert.equal(await bucket.get(fileKey), null);
  // Encryption returns a byte view, which may represent only part of a buffer.
  await bucket.put(fileKey, new Uint8Array([9, 4, 5, 9]).subarray(1, 3));
  assert.deepEqual(
    new Uint8Array(await (await bucket.get(fileKey)).arrayBuffer()),
    new Uint8Array([4, 5]),
  );
  await bucket.delete(fileKey);
});

test('private file adapter rejects URLs and invalid paths before any provider call', async () => {
  assert.throws(() => createPrivateBucket(''), /not configured/);
  const bucket = createPrivateBucket('fictional-token');
  const beforeCalls = calls.length;
  for (const key of ['https://external.example/file', '../file', '/project-files/file', 'project-files/../file', '']) {
    await assert.rejects(bucket.put(key, new ArrayBuffer(1)), /Invalid private file key/);
    await assert.rejects(bucket.get(key), /Invalid private file key/);
    await assert.rejects(bucket.delete(key), /Invalid private file key/);
  }
  assert.equal(calls.length, beforeCalls);
});

test('private storage errors do not retry as public or return incomplete bytes', async () => {
  const bucket = createPrivateBucket('fictional-token');
  const originalGet = globalThis.__weftBlobSdk.get;
  let attempts = 0;
  try {
    globalThis.__weftBlobSdk.get = async (_key, options) => {
      attempts++;
      assert.equal(options.access, 'private');
      throw new Error('Storage access denied');
    };
    await assert.rejects(bucket.get(fileKey), /Storage access denied/);
    assert.equal(attempts, 1);
    globalThis.__weftBlobSdk.get = async () => ({ statusCode: 304 });
    await assert.rejects(bucket.get(fileKey), /incomplete object/);
  } finally {
    globalThis.__weftBlobSdk.get = originalGet;
  }
});

test('connected storage delegates short-lived OIDC resolution to the SDK for each private operation', async () => {
  const bucket = createPrivateBucket({storeId:' store_fictional123 '});
  await bucket.put(fileKey, new Uint8Array([4, 2]));
  assert.deepEqual(calls.at(-1).options, {storeId:'store_fictional123',access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:'application/octet-stream'});
  assert.deepEqual(new Uint8Array(await (await bucket.get(fileKey)).arrayBuffer()),new Uint8Array([4,2]));
  assert.deepEqual(calls.at(-1).options,{storeId:'store_fictional123',access:'private'});
  await bucket.delete(fileKey);
  assert.deepEqual(calls.at(-1).options,{storeId:'store_fictional123'});
  assert.throws(()=>createPrivateBucket({storeId:'   '}),/not configured/);
});

test('runtime uses connected store IDs without a static token and preserves explicit legacy credentials', async () => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
  process.env.BLOB_STORE_ID='store_first123';
  const connected=env.BUCKET;assert.ok(connected);assert.equal(env.BUCKET,connected);
  await connected.get(fileKey);assert.equal(calls.at(-1).options.storeId,'store_first123');
  process.env.BLOB_STORE_ID='store_second456';
  assert.notEqual(env.BUCKET,connected);
  await env.BUCKET.get(fileKey);assert.equal(calls.at(-1).options.storeId,'store_second456');
  process.env.BLOB_READ_WRITE_TOKEN='fictional-explicit-token';
  await env.BUCKET.get(fileKey);assert.deepEqual(calls.at(-1).options,{token:'fictional-explicit-token',access:'private'});
  delete process.env.BLOB_READ_WRITE_TOKEN;delete process.env.BLOB_STORE_ID;
  assert.equal(env.BUCKET,undefined,'Removing configuration disables storage even if an adapter was cached');
});
