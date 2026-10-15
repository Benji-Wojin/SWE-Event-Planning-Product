import { before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

let auth, compatibility, route;
before(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weft-auth-test-'));
  await build({
    entryPoints: {
      auth: 'auth.ts', compatibility: 'app/chatgpt-auth.ts',
      route: 'app/api/auth/[...nextauth]/route.ts',
    },
    outdir: directory, bundle: true, platform: 'node', format: 'esm',
    plugins: [{ name: 'auth-test-runtime', setup(b) {
      b.onResolve({ filter: /^@\/lib\/runtime$/ }, () => ({ path: 'runtime', namespace: 'mock' }));
      b.onResolve({ filter: /^(next-auth(?:\/providers\/google)?|next\/navigation|next\/headers)$/ }, args => ({ path: args.path, namespace: 'mock' }));
      b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ loader: 'js', contents: {
        'runtime': `export const env = {
          get WEFT_PRIVATE_BETA() { return globalThis.__betaMode; },
          GATHER_OWNER_EMAIL: 'owner@example.com', WEFT_BETA_EMAILS: 'allowed@example.com',
          DB: { prepare: () => ({ bind: () => ({ first: async () => globalThis.__betaExisting ? {found:1} : null }) }) }
        };`,
        'next-auth': `export async function getServerSession() {
          globalThis.__authSessionCalls++;
          if (globalThis.__authSessionError) throw new Error('sensitive failure');
          return globalThis.__authSession;
        }
        export default function NextAuth(options) {return async () => {
          globalThis.__authHandlerCalls++;
          if (globalThis.__authHandlerError) throw new Error('sensitive failure');
          return new Response('auth response');
        };}`,
        'next-auth/providers/google': 'export default function Google(options) { return {id: "google", ...options}; }',
        'next/navigation': 'export function redirect(path) { throw Object.assign(new Error("redirect"), {path}); }',
        'next/headers': 'export function headers() { throw new Error("Caller-supplied identity headers must not be read"); }',
      }[args.path] }));
    } }],
  });
  [auth, compatibility, route] = await Promise.all(['auth', 'compatibility', 'route'].map(name => import(pathToFileURL(join(directory, name + '.js')))));
});

beforeEach(() => {
  process.env.NEXTAUTH_URL = 'https://weft.example';
  process.env.NEXTAUTH_SECRET = 'fictional-test-secret-not-used-outside-tests';
  process.env.GOOGLE_CLIENT_ID = 'fictional-client';
  process.env.GOOGLE_CLIENT_SECRET = 'fictional-secret';
  globalThis.__authSession = null;
  globalThis.__authSessionCalls = 0;
  globalThis.__authSessionError = false;
  globalThis.__authHandlerCalls = 0;
  globalThis.__authHandlerError = false;
  globalThis.__betaMode = 'false';
  globalThis.__betaExisting = false;
});

test('protected page redirects a verified but unapproved beta account without a sign-in loop', async () => {
  globalThis.__betaMode = 'true';
  globalThis.__authSession = { weftUser: user() };
  await assert.rejects(compatibility.requireChatGPTUser('/project'), error => error.path === '/beta');
  globalThis.__betaExisting = true;
  assert.deepEqual(await compatibility.requireChatGPTUser('/project'), user());
});

const profile = () => ({ sub: '12345', email: 'PERSON@example.com', email_verified: true, name: 'Example Person' });
const user = () => ({ userId: 'google:12345', email: 'person@example.com', fullName: 'Example Person', displayName: 'Example Person' });

test('authentication reads only verified sessions, ignoring forged legacy identity headers', async () => {
  globalThis.__forgedHeaders = new Headers({ 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'owner@example.com' });
  assert.equal(await compatibility.getChatGPTUser(), null);
  assert.equal(globalThis.__authSessionCalls, 1);
  globalThis.__authSession = { user: { email: 'owner@example.com' } };
  assert.equal(await compatibility.getChatGPTUser(), null);
  globalThis.__authSession = { weftUser: user() };
  assert.deepEqual(await compatibility.getChatGPTUser(), user());
});

test('missing, weak or invalid configuration fails closed before reading a session', async () => {
  for (const key of ['NEXTAUTH_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'NEXTAUTH_URL']) {
    const original = process.env[key];
    delete process.env[key];
    assert.equal(auth.isAuthConfigured(), false, key);
    assert.equal(await auth.getAuthenticatedUser(), null);
    process.env[key] = original;
  }
  process.env.NEXTAUTH_SECRET = 'weak';
  assert.equal(auth.isAuthConfigured(), false);
  assert.equal(globalThis.__authSessionCalls, 0);
});

test('canonical auth origin disallows remote HTTP, credentials and URL suffixes', () => {
  for (const value of ['http://weft.example', 'https://user:pass@weft.example', 'https://weft.example/path', 'https://weft.example/?query=1', 'https://weft.example/#hash', 'invalid']) {
    process.env.NEXTAUTH_URL = value;
    assert.equal(auth.authOrigin(), null, value);
  }
  process.env.NEXTAUTH_URL = 'https://weft.example';
  assert.equal(auth.authOrigin(), 'https://weft.example');
});

test('only Google with a strictly verified email and stable subject may sign in', async () => {
  const callback = auth.getAuthOptions().callbacks.signIn;
  assert.equal(await callback({ account: { provider: 'google' }, profile: profile() }), true);
  for (const rejected of [undefined, {}, { ...profile(), email_verified: false }, { ...profile(), email_verified: 'true' }, { ...profile(), sub: '' }, { ...profile(), email: 'not-an-email' }]) {
    assert.equal(await callback({ account: { provider: 'google' }, profile: rejected }), false);
  }
  assert.equal(await callback({ account: { provider: 'other' }, profile: profile() }), false);
});

test('session identity uses Google subject, never email as an ID or caller session updates', async () => {
  const callbacks = auth.getAuthOptions().callbacks;
  const token = await callbacks.jwt({ token: {}, account: { provider: 'google' }, profile: profile() });
  assert.deepEqual(token.weftUser, user());
  const updated = await callbacks.jwt({ token, trigger: 'update', session: { weftUser: { userId: 'admin' } } });
  assert.deepEqual(updated.weftUser, user());
  const session = await callbacks.session({ session: { expires: 'tomorrow', user: { email: 'forged@example.com' } }, token: { ...token, access_token: 'not-for-browser' } });
  assert.deepEqual(session, { expires: 'tomorrow', weftUser: user() });
  await assert.rejects(callbacks.jwt({ token: {}, account: { provider: 'google' }, profile: { ...profile(), email_verified: false } }));
});

test('session failures and malformed identity remain unauthenticated', async () => {
  globalThis.__authSessionError = true;
  assert.equal(await compatibility.getChatGPTUser(), null);
  globalThis.__authSessionError = false;
  globalThis.__authSession = { weftUser: { ...user(), userId: 'legacy-owner-id' } };
  assert.equal(await compatibility.getChatGPTUser(), null);
  globalThis.__authSession = { weftUser: { ...user(), email: null } };
  assert.equal(await compatibility.getChatGPTUser(), null);
});

test('return paths reject open redirects, control characters and auth loops', () => {
  for (const value of ['https://evil.example', '//evil.example', '/\\evil.example', '/\n/evil.example', '/signin-with-chatgpt', '/signin-with-chatgpt/', '/signout-with-chatgpt?return_to=/demo', '/api/auth/signout', '/api/auth', '/%73ignin-with-chatgpt', '/callback', '/%zz', null]) {
    assert.equal(auth.safeRelativeReturnPath(value), '/', String(value));
  }
  assert.equal(auth.safeRelativeReturnPath('/project?project=test#tasks'), '/project?project=test#tasks');
  assert.equal(compatibility.chatGPTSignInPath('/project?project=test'), '/signin-with-chatgpt?return_to=%2Fproject%3Fproject%3Dtest');
  assert.equal(compatibility.chatGPTSignOutPath('//evil.example'), '/signout-with-chatgpt?return_to=%2F');
});

test('OAuth redirects ignore supplied base URLs and use only configured origin', async () => {
  const redirect = auth.getAuthOptions().callbacks.redirect;
  assert.equal(await redirect({ url: 'https://evil.example', baseUrl: 'https://evil.example' }), 'https://weft.example/');
  assert.equal(await redirect({ url: '/project?project=test', baseUrl: 'https://evil.example' }), 'https://weft.example/project?project=test');
  assert.equal(await redirect({ url: '/project?project=test#timeline', baseUrl: 'https://evil.example' }), 'https://weft.example/project?project=test#timeline');
  assert.equal(auth.safeAuthRedirect('https://weft.example/api/auth/signout'), 'https://weft.example/');
});

test('auth endpoint returns safe 503 responses when unconfigured or failing', async () => {
  delete process.env.GOOGLE_CLIENT_SECRET;
  let result = await route.GET(new Request('https://weft.example/api/auth/session'), { params: Promise.resolve({ nextauth: ['session'] }) });
  assert.equal(result.status, 503);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(globalThis.__authHandlerCalls, 0);
  process.env.GOOGLE_CLIENT_SECRET = 'fictional-secret';
  globalThis.__authHandlerError = true;
  result = await route.POST(new Request('https://weft.example/api/auth/signin/google', { method: 'POST' }), { params: Promise.resolve({ nextauth: ['signin', 'google'] }) });
  assert.equal(result.status, 503);
  assert.doesNotMatch(await result.text(), /sensitive|fictional-secret/);
});

test('sign-out compatibility page cannot mutate a session on GET', () => {
  const page = readFileSync('app/signout-with-chatgpt/page.tsx', 'utf8');
  const button = readFileSync('app/signout-with-chatgpt/sign-out-button.tsx', 'utf8');
  assert.doesNotMatch(page, /signOut\(/);
  assert.match(button, /onClick=\{\(\) => void confirmSignOut\(\)\}/);
  assert.doesNotMatch(button, /useEffect|autoFocus/);
  assert.match(button, /from 'next-auth\/react'/);
});
