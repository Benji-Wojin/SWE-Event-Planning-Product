import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const source = readFileSync('legacy/hosted-store.js', 'utf8');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const state = { state: { event: {} }, identity: { actorId: 'jack', role: 'admin' }, projectId: 'new-project', demo: false, revision: 1, suggestions: [], exportState: {} };
function element(tag) {
  return { tag, hidden: false, style: {}, attributes: {}, children: [], listeners: {},
    setAttribute(k, v) { this.attributes[k] = v; },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
  };
}
function start(response, { oldDocument = false } = {}) {
  const boot = element('main'), shell = element('div'), body = element('body'), listeners = {};
  shell.hidden = !oldDocument;boot.attributes['aria-busy'] = 'true';
  body.classList = { toggle() {} };
  body.insertBefore = node => body.children.unshift(node);
  let reloads = 0, redirect;
  const document = {
    getElementById: id => id === 'workspaceBoot' ? oldDocument ? null : boot : shell,
    querySelectorAll: () => [], querySelector: () => null, createElement: element, body,
  };
  const window = { top: { location: { replace(value) { redirect = value; } } }, addEventListener(type, fn) { listeners[type] = fn; } };
  const run = vm.runInNewContext(source, { window, document,
    location: { search: '?project=new-project', origin: 'https://weft.example', reload() { reloads++; } },
    URL, URLSearchParams, structuredClone, AbortController, setTimeout, clearTimeout,
    fetch: (...args) => typeof response === 'function' ? response(...args) : response,
  });
  return { boot: oldDocument ? body.children[0] : boot, shell, body, window, run, listeners,
    reloads: () => reloads, redirect: () => redirect };
}
const success = value => ({ ok: true, status: 200, json: async () => value });
const text = node => [node.textContent || '', ...node.children.map(text)].join(' ');

test('prepared hosted HTML shows loading instead of demo identity or interactive shell', () => {
  execFileSync(process.execPath, ['scripts/prepare.mjs']);
  const html = readFileSync('public/workspace.html', 'utf8');
  assert.match(html, /id="workspaceBoot"[^>]+aria-busy="true"/);
  assert.match(html, /<p role="status">Loading project…<\/p>/);
  assert.match(html, /id="appShell" hidden/);
  assert.doesNotMatch(html, /Field Day 2026|event-symbol">FD/);
  assert.match(readFileSync('legacy/styles.css', 'utf8'), /\[hidden\]\{display:none!important\}/);
  const app = readFileSync('public/gather-assets/app.js', 'utf8');
  assert.ok(app.indexOf('navigate(navigation.initial());') < app.indexOf("new Event('gather-workspace-ready')"));
});

test('a stalled workspace load exposes retry without revealing sample data', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const h = start((_, options) => {
    signal = options.signal;
    return new Promise(() => {});
  });
  t.mock.timers.tick(30_001);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.boot.attributes['aria-busy'], 'false');
  assert.equal(h.shell.hidden, true);
  assert.match(text(h.boot), /too long/);
  assert.equal(signal.aborted, true);
  h.boot.children[2].children[0].listeners.click();
  assert.equal(h.reloads(), 1);
});

test('a stalled task save rejects without discarding the snapshot or blocking a later refresh', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const write = deferred();
  let posts = 0, signal, result;
  let latest = state;
  const h = start((_, options) => {
    if (options.method === 'POST') { posts++; signal = options.signal; return write.promise; }
    return Promise.resolve(success(latest));
  });
  await h.run;
  const store = h.window.GatherStore.createStore();
  store.addComment('fixture', 'The room is ready.').then(
    () => { result = 'saved'; }, error => { result = error.message; },
  );
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(30_001);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(result || '', /may have completed.*Reload/);
  assert.equal(signal.aborted, true);
  assert.equal(posts, 1);
  assert.deepEqual(store.getState(), state.state);
  latest = { ...state, revision: 3, state: { event: { name: 'Current plan' } } };
  await store.refresh(() => true);
  write.resolve(success({ ...state, revision: 2, state: { event: { name: 'Old response' } } }));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(store.getState(), latest.state, 'late save response must not overwrite the refreshed plan');
  assert.notEqual(result, 'saved');
  assert.equal(posts, 1, 'no automatic resend');
});

test('a timed-out response body cannot redirect or clear the plan when it eventually arrives', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const body = deferred();
  let reads = 0, result, signal;
  const h = start((_, options) => {
    signal = options.signal;
    return Promise.resolve(++reads === 1 ? success(state)
      : { ok: false, status: 401, json: () => body.promise });
  });
  await h.run;
  const store = h.window.GatherStore.createStore();
  store.refresh(() => true).catch(error => { result = error.message; });
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(30_001);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(result || '', /too long/);
  assert.equal(signal.aborted, true);
  body.resolve({ error: 'Old authentication response' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.window.top.location.href, undefined);
  assert.equal(h.redirect(), undefined);
  assert.deepEqual(store.getState(), state.state);
});

test('slow snapshot and app download keep shell hidden until initial render completes', async () => {
  const pending = deferred(), h = start(pending.promise);
  assert.equal(h.shell.hidden, true);assert.equal(h.boot.hidden, false);
  pending.resolve(success(state));await h.run;
  const script = h.body.children.find(node => node.tag === 'script');assert.ok(script);
  assert.equal(h.shell.hidden, true, 'Fetching state alone is not a rendered workspace');
  h.listeners['gather-workspace-ready']();script.onload();
  assert.equal(h.shell.hidden, false);assert.equal(h.boot.hidden, true);
  assert.equal(h.boot.attributes['aria-busy'], 'false');
});

test('failed initial request shows escaped retry information without revealing shell', async () => {
  const h = start(Promise.resolve({ ok: false, status: 503, json: async () => ({ error: '<img src=x onerror=alert(1)>' }) }));
  await h.run;
  assert.equal(h.shell.hidden, true);assert.equal(h.boot.hidden, false);
  assert.equal(h.boot.attributes['aria-busy'], 'false');
  assert.match(text(h.boot), /Your plan could not be loaded/);
  const detail = h.boot.children[1];assert.equal(detail.textContent, '<img src=x onerror=alert(1)>');assert.equal(detail.innerHTML, undefined);
  const actions = h.boot.children[2].children;
  assert.equal(actions[1].href, '/');assert.match(actions[2].href, /return_to=/);
  actions[0].listeners.click();assert.equal(h.reloads(), 1);
  assert.equal(h.body.children.some(node => node.tag === 'script'), false);
});

test('failed app download or initialization gives a working retry screen', async () => {
  for (const event of ['onerror', 'onload']) {
    const h = start(Promise.resolve(success(state)));await h.run;
    h.body.children.find(node => node.tag === 'script')[event]();
    assert.equal(h.shell.hidden, true);assert.equal(h.boot.hidden, false);
    assert.match(text(h.boot), /Your plan could not be loaded/);
    h.boot.children[2].children[0].listeners.click();assert.equal(h.reloads(), 1);
  }
});

test('older open documents receive a loading screen and setup redirects never reveal shell', async () => {
  const old = start(Promise.resolve(success(state)), { oldDocument: true });await old.run;
  assert.match(text(old.boot), /Loading project/);assert.equal(old.shell.hidden, true);
  old.listeners['gather-workspace-ready']();assert.equal(old.shell.hidden, false);assert.equal(old.boot.hidden, true);
  const h = start(Promise.resolve(success({ ...state, setupRequired: true })));await h.run;
  assert.equal(h.redirect(), '/setup?project=new-project');assert.equal(h.shell.hidden, true);
  assert.equal(h.body.children.some(node => node.tag === 'script'), false);
});
