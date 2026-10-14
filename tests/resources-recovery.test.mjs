import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('legacy/resources-ui.js', 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const response = (data, ok = true) => ({ ok, json: async () => data });
const ready = (location = '') => ({ status: 'ready', links: [], location });
function fixture(fetcher) {
  const document = { body: {}, activeElement: null, createElement: () => ({ setAttribute() {}, textContent: '' }) };
  document.activeElement = document.body;
  const window = { GatherMode: { projectId: 'qa-project' } }, calls = [];
  vm.runInNewContext(source, { window, document, URLSearchParams, AbortController, Date, setTimeout, clearTimeout,
    fetch: (url, options) => { calls.push({ url, ...options }); return fetcher(url, options); } });
  function container(draft) {
    const listeners = {}, elements = {};
    const node = { isConnected: true, html: '',
      contains: element => Object.values(elements).includes(element),
      addEventListener: (name, fn) => { listeners[name] = fn; },
      append: element => { elements['.resource-error'] = element; },
      querySelector: selector => elements[selector] || null,
      set innerHTML(html) {
        for (const element of Object.values(elements)) element.isConnected = false;
        if (this.contains(document.activeElement)) document.activeElement = document.body;
        for (const key of Object.keys(elements)) delete elements[key];
        this.html = html;
        const error = /class="resource-error warning-note" role="alert">([^<]*)</.exec(html);
        if (error) elements['.resource-error'] = { textContent: error[1] };
        const element = tagName => ({ tagName, isConnected: true, focus() { document.activeElement = this; } });
        if (html.includes('<details')) { elements.details = { ...element('DETAILS'), open: false }; elements.summary = element('SUMMARY'); }
        if (html.includes('<form')) {
          const value = /name="location"[^>]*value="([^"]*)"/.exec(html)?.[1] || '';
          elements.input = { ...element('INPUT'), value, defaultValue: value };
          elements.button = { ...element('BUTTON'), disabled: /type="submit" disabled/.test(html) };
          elements.form = { ...element('FORM'), elements: { location: elements.input }, matches: selector => selector === '.resource-form' };
        }
      },
    };
    return { dataset: draft === undefined ? {} : { resourceDraft: draft }, querySelector: () => node, node, elements,
      submit() { listeners.submit({ target: elements.form, preventDefault() {}, stopPropagation() {} }); },
      reload() { listeners.click({ target: { closest: selector => selector === '[data-resource-retry]' ? {} : null }, preventDefault() {} }); },
    };
  }
  return { window, document, calls, container, mount: (c, id = 'qa-task') => window.GatherResourcesUI.mount(id, c) };
}

test('stalled initial read aborts after 30 seconds and exposes read-only retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let count = 0;
  const f = fixture(() => ++count === 1 ? new Promise(() => {}) : response(ready()));
  const c = f.container(); let settled = false;
  const run = f.mount(c).then(() => { settled = true; });
  t.mock.timers.tick(30001); await flush();
  assert.equal(settled, true);
  await run;
  assert.equal(f.calls[0].signal.aborted, true);
  assert.match(c.elements['.resource-error'].textContent, /too long/i);
  c.reload(); await flush();
  assert.deepEqual(f.calls.map(c => c.method), ['GET', 'GET']);
  assert.equal(c.elements['.resource-error'], undefined);
});

test('stalled search preserves input and disclosure; late response cannot overwrite reload', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deferred();
  const f = fixture((_, options) => options.method === 'POST' ? pending.promise : response(ready('Saved city')));
  const c = f.container(); await f.mount(c);
  c.elements.input.value = 'Typed city'; c.elements.details.open = true; c.elements.input.focus(); c.submit();
  await flush(); t.mock.timers.tick(30001); await flush();
  assert.equal(c.elements.input.value, 'Typed city'); assert.equal(c.elements.details.open, true);
  assert.match(c.elements['.resource-error'].textContent, /may still/i);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  c.reload(); await flush();
  assert.equal(c.elements.input.value, 'Typed city'); assert.equal(c.elements.details.open, true);
  assert.equal(c.elements['.resource-error'], undefined);
  const html = c.node.html;
  pending.resolve(response(ready('Outdated city'))); await flush();
  assert.equal(c.node.html, html); assert.equal(c.elements.input.value, 'Typed city');
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  c.submit(); await flush();
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 2, 'explicit later submission is allowed');
});

test('stalled JSON body is bounded even when transport ignores abort', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const body = deferred(); const f = fixture(() => ({ ok: true, json: () => body.promise }));
  const c = f.container(); const run = f.mount(c); await flush();
  t.mock.timers.tick(30001); await flush();
  assert.match(c.elements['.resource-error']?.textContent || '', /too long/i); await run;
  body.resolve(ready('Late city')); await flush();
  assert.match(c.elements['.resource-error'].textContent, /too long/i);
});

test('reopened task releases stalled shared search without automatically resending it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture((_, options) => options.method === 'POST' ? new Promise(() => {}) : response({ status: 'empty', links: [] }));
  const first = f.container(); const a = f.mount(first); await flush();
  first.node.isConnected = false;
  const second = f.container('Keep city'); const b = f.mount(second); await flush();
  t.mock.timers.tick(30001); await flush();
  assert.ok(second.elements['.resource-error']); await Promise.all([a, b]);
  const third = f.container(); await f.mount(third);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  assert.equal(third.elements.button.disabled, false);
});

test('normal initial empty read still generates once and unconfigured search stays disabled', async () => {
  let count = 0;
  const f = fixture(() => response(++count === 1 ? { status: 'empty', links: [] } : ready()));
  await f.mount(f.container());
  assert.deepEqual(f.calls.map(c => c.method), ['GET', 'POST']);
  const disabled = fixture(() => response({ status: 'unconfigured', links: [] }));
  const c = disabled.container(); await disabled.mount(c);
  assert.equal(c.elements.form, undefined); assert.equal(disabled.calls.length, 1);
});

test('pending requests for equal task IDs in different projects remain separate', async () => {
  const first = deferred(); let count = 0;
  const f = fixture(() => ++count === 1 ? first.promise : response(ready()));
  const a = f.mount(f.container());
  f.window.GatherMode.projectId = 'second-qa-project';
  const b = f.mount(f.container()); await flush();
  assert.equal(f.calls.length, 2);
  first.resolve(response(ready())); await Promise.all([a, b]);
  assert.match(f.calls[0].url, /project=qa-project/);
  assert.match(f.calls[1].url, /project=second-qa-project/);
});

test('polling exhaustion preserves draft and manual reload gets a fresh polling window', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const f = fixture(() => response({ status: 'loading', links: [], location: 'Saved city' }));
  const c = f.container(); await f.mount(c);
  c.elements.input.value = 'Draft city'; c.elements.details.open = true; c.elements.input.focus();
  t.mock.timers.tick(66000); await flush();
  assert.match(c.elements['.resource-error'].textContent, /still be running/);
  assert.equal(c.elements.input.value, 'Draft city');
  assert.equal(c.elements.details.open, true);
  assert.equal(f.document.activeElement, c.elements.input);
  const count = f.calls.length;
  t.mock.timers.tick(2000); await flush(); assert.equal(f.calls.length, count);
  c.reload(); await flush();
  assert.equal(c.elements['.resource-error'], undefined);
  t.mock.timers.tick(2000); await flush();
  assert.equal(f.calls.length, count + 2);
  assert.ok(f.calls.every(call => call.method === 'GET'));
  c.node.isConnected = false;
});

test('network failure recovers without a mutation retry and preserves an explicitly empty draft', async () => {
  let fail = false;
  const f = fixture((_, options) => {
    if (options.method === 'POST') { fail = true; throw new Error('Network unavailable'); }
    return response(ready('Saved city'));
  });
  const c = f.container(); await f.mount(c);
  c.elements.input.value = ''; c.submit(); await flush();
  assert.equal(fail, true);
  assert.equal(c.elements.input.value, '');
  assert.equal(c.elements.button.disabled, true);
  c.reload(); c.reload(); await flush();
  assert.deepEqual(f.calls.map(call => call.method), ['GET', 'POST', 'GET']);
  assert.equal(c.elements.input.value, '');
  assert.equal(c.elements.button.disabled, false);
});

test('remount revalidates a shared result after task metadata changes without generating again', async () => {
  const old = deferred(); let count = 0;
  const f = fixture(() => ++count === 1 ? old.promise : response({ status: 'empty', links: [], location: 'Current city' }));
  const first = f.container(); const a = f.mount(first);
  first.node.isConnected = false;
  const second = f.container(); const b = f.mount(second);
  old.resolve(response(ready('Outdated city')));
  await Promise.all([a, b]);
  assert.deepEqual(f.calls.map(call => call.method), ['GET', 'GET']);
  assert.equal(second.elements.input.value, 'Current city');
});
