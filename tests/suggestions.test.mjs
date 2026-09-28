import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/store.js';

const source = readFileSync(new URL('../legacy/hosted-store.js', import.meta.url), 'utf8');
const snapshot = (revision, suggestions = []) => ({ revision, suggestions, demo: false,
  identity: { actorId: 'jack', role: 'admin' }, state: { revision }, exportState: { revision } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function hosted(initial) {
  let respond = async () => initial;
  const window = {};
  const document = { body: { classList: { toggle() {} }, append() {} }, createElement: () => ({}) };
  await vm.runInNewContext(source, { window, document, location: { search: '' }, URLSearchParams, structuredClone,
    fetch: async (_, options) => ({ ok: true, status: 200, json: async () => respond(options) }) });
  assert.ok(window.GatherStore, 'Hosted store initialized');
  return { store: window.GatherStore.createStore(), respond: fn => { respond = fn; } };
}

test('planning checks react to the clock without a project edit', () => {
  let now = Date.parse('2026-09-28T12:00:00Z');
  const store = GatherStore.createStore({ storage: null, now: () => now });
  store.updateEvent({ cateringDeadline: '2026-10-02', dietaryOutstanding: 3 });
  const saved = store.exportState();
  assert.ok(!store.getSuggestions().some(s => s.id === 'dietary-cutoff'));
  now += 2 * 86400000;
  assert.ok(store.getSuggestions().some(s => s.id === 'dietary-cutoff'));
  assert.equal(store.exportState(), saved, 'Derived checks must not create a task or write state');
});

test('new context and feedback update checks; covered and dismissed suggestions stay quiet', () => {
  const store = GatherStore.createStore({ storage: null, now: Date.parse('2026-09-28T12:00:00Z') });
  store.updateEvent({ outdoor: false });
  assert.ok(!store.getSuggestions().some(s => s.id === 'rain'));
  store.updateEvent({ outdoor: true });
  assert.ok(store.getSuggestions().some(s => s.id === 'rain'));
  store.addTask({ title: 'Choose the rain backup venue', owner: 'jack', category: 'Venue' });
  assert.ok(!store.getSuggestions().some(s => s.id === 'rain'));
  store.dismissSuggestion('accessibility');
  const memory = store.addMemory({ change: 'Label food stations before arrival', scope: 'always' });
  assert.ok(store.getSuggestions().some(s => s.id === 'lesson-' + memory.id));
  store.acceptSuggestion('lesson-' + memory.id);
  store.updateEvent({ guestCount: 200 });
  assert.ok(!store.getSuggestions().some(s => ['accessibility', 'rain', 'lesson-' + memory.id].includes(s.id)));
});

test('same-revision time-driven suggestions update without replacing draft-sensitive state', async () => {
  const { store, respond } = await hosted(snapshot(1));
  let fullUpdates = 0; store.subscribe(() => fullUpdates++);
  respond(async () => ({ ...snapshot(1, [{ id: 'dietary-cutoff' }]), state: { unsafe: 'must not overwrite draft state' } }));
  const result = await store.refresh(() => false);
  assert.equal(result.changed, false); assert.equal(result.suggestionsChanged, true);
  assert.deepEqual(store.getSuggestions(), [{ id: 'dietary-cutoff' }]);
  assert.deepEqual(store.getState(), { revision: 1 }); assert.equal(fullUpdates, 0);
  assert.equal((await store.refresh(() => false)).suggestionsChanged, false);
});

test('new project revisions wait for drafts instead of mixing old tasks with new suggestions', async () => {
  const { store, respond } = await hosted(snapshot(1));
  respond(async () => snapshot(2, [{ id: 'lesson-new' }]));
  assert.equal((await store.refresh(() => false)).pending, true);
  assert.deepEqual(store.getState(), { revision: 1 }); assert.deepEqual(store.getSuggestions(), []);
  assert.equal((await store.refresh(() => true)).changed, true);
  assert.deepEqual(store.getState(), { revision: 2 }); assert.deepEqual(store.getSuggestions(), [{ id: 'lesson-new' }]);
});

test('a late refresh cannot undo a dismissal or overwrite a mutation response', async () => {
  const { store, respond } = await hosted(snapshot(1, [{ id: 'rain' }]));
  const pending = deferred(), started = deferred();
  respond(async options => {
    if (options.method === 'POST') return snapshot(2);
    started.resolve(); return pending.promise;
  });
  const refresh = store.refresh(() => true); await started.promise;
  await store.dismissSuggestion('rain'); pending.resolve(snapshot(1, [{ id: 'rain' }]));
  assert.equal((await refresh).changed, false);
  assert.deepEqual(store.getSuggestions(), []); assert.deepEqual(store.getState(), { revision: 2 });
});

test('a same-revision refresh arriving during a queued mutation is not applied', async () => {
  const { store, respond } = await hosted(snapshot(1));
  const pending = deferred(), started = deferred(), mutation = deferred();
  respond(async options => {
    if (options.method === 'POST') return mutation.promise;
    started.resolve(); return pending.promise;
  });
  const refresh = store.refresh(() => true); await started.promise;
  const save = store.updateEvent({ outdoor: false });
  pending.resolve(snapshot(1, [{ id: 'rain' }])); await refresh;
  assert.deepEqual(store.getSuggestions(), []);
  mutation.resolve(snapshot(2)); await save;
});

test('out-of-order same-revision reads cannot restore an older derived suggestion', async () => {
  const { store, respond } = await hosted(snapshot(1));
  const older = deferred(), started = deferred(); let reads = 0;
  respond(async () => {
    if (++reads === 1) { started.resolve(); return older.promise; }
    return snapshot(1, [{ id: 'current-check' }]);
  });
  const slow = store.refresh(() => true); await started.promise;
  await store.refresh(() => true);
  older.resolve(snapshot(1, [{ id: 'outdated-check' }])); await slow;
  assert.deepEqual(store.getSuggestions(), [{ id: 'current-check' }]);
});

test('restoring the page from browser history resumes a single refresh timer', () => {
  const app = readFileSync(new URL('../scripts/prepare.mjs', import.meta.url), 'utf8');
  const start = app.indexOf('  let inboxRefreshTimer;'), end = app.indexOf('  setDrawer(false);', start);
  assert.ok(start > 0 && end > start);
  const listeners = {}, timers = new Set(); let next = 0, refreshes = 0;
  vm.runInNewContext(app.slice(start, end), {
    window: { GatherMode: { demo: true }, addEventListener: (name, fn) => { listeners[name] = fn; } },
    document: { hidden: false, addEventListener: (name, fn) => { listeners[name] = fn; } },
    setInterval: (_, interval) => { assert.equal(interval, 4000); timers.add(++next); return next; },
    clearInterval: id => timers.delete(id), refreshInbox: () => { refreshes++; },
  });
  assert.equal(timers.size, 1);
  listeners.pagehide({ persisted: true }); assert.equal(timers.size, 0);
  listeners.pageshow({ persisted: true }); assert.equal(timers.size, 1); assert.equal(refreshes, 1);
  listeners.pageshow({ persisted: true }); assert.equal(timers.size, 1);
  listeners.visibilitychange(); assert.equal(refreshes, 3);
});
