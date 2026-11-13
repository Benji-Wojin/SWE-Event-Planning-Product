import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('legacy/app.js', 'utf8');
const day = '2026-11-20';

function fixture() {
  const scope = { mine: true, actor: 'maya', date: day };
  const snapshot = { scope, revision: 1, stale: true };
  const ui = { view: 'timeline', timelineMode: 'schedule', actor: 'maya', scheduleMine: true, scheduleDate: day,
    dialogKind: 'run-sheet', runSheet: snapshot, toolUpdatePending: true };
  const window = { GatherMode: { projectId: 'fictional' } }, document = { hidden: false };
  const sync = { hidden: false }, status = { textContent: '' }, backdrop = { hidden: false }, dialog = {};
  const events = [], requests = [], busyRunSheetRevisions = new Set();
  let revision = 1, known = 1, title = {};
  const context = vm.createContext({
    ui, window, document, busyRunSheetRevisions,
    $: selector => ({ '#eventRunSheet': {}, '#dialogTitle': title, '#dialog': dialog, '#dialogBackdrop': backdrop,
      '#runSheetRefreshStatus': status, '#workspaceSyncNotice': sync })[selector] ?? null,
    currentRunSheet() { events.push(['recheck']); return null; },
    rememberNewerSchedule(_snapshot, candidate) { if (Number.isSafeInteger(candidate)) known = Math.max(known, candidate); },
    scheduleRevisionIsStale: candidate => Number.isSafeInteger(candidate) && candidate < known,
    recoveryConflictPending: () => false,
    render: () => events.push(['render', revision]),
    openRunSheet: (nextScope, focusHeading) => events.push(['open', nextScope, focusHeading]),
    toast: message => events.push(['toast', message]),
    store: {
      getSnapshotRevision: () => revision,
      confirmSnapshotRevision: async () => { events.push(['second read']); return false; },
      refresh(canApply, options) {
        return new Promise((resolve, reject) => requests.push({ canApply, options, reject,
          finish(candidate, result = { changed: candidate !== revision, verified: true }) {
            if (canApply(candidate)) {
              if (result.changed) revision = candidate;
              resolve(result);
            } else resolve({ changed: false, ...(candidate > revision ? { pending: true, newerRevision: candidate } : {}) });
          },
        }));
      },
    },
  });
  const from = source.indexOf('  async function refreshRunSheet('), to = source.indexOf('\n  }', from);
  assert.ok(from >= 0 && to > from, 'run-sheet refresh handler is present');
  vm.runInContext(source.slice(from, to) + '\n  }', context);
  return { ui, window, document, sync, status, backdrop, scope, snapshot, events, requests, busyRunSheetRevisions,
    get revision() { return revision; }, get known() { return known; }, set known(value) { known = value; },
    replaceTitle() { title = {}; },
    refresh: () => context.refreshRunSheet(),
  };
}

test('run-sheet refresh rejects an intermediate revision before publication, then rebuilds the original scope at the known floor', async () => {
  const f = fixture();
  f.known = 4;
  const blocked = f.refresh();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].options.requireFresh, true);
  assert.equal(f.busyRunSheetRevisions.has(1), true);
  await f.refresh();
  assert.equal(f.requests.length, 1, 'a duplicate click while busy cannot start another read');
  assert.equal(f.requests[0].canApply(2), false);
  assert.equal(f.requests[0].canApply(4), true);
  f.requests[0].finish(2);
  await blocked;
  assert.equal(f.revision, 1, 'the intermediate result never reaches the shared snapshot');
  assert.equal(f.known, 4);
  assert.equal(f.sync.hidden, false);
  assert.equal(f.busyRunSheetRevisions.size, 0);
  assert.ok(f.events.every(([kind]) => !['render', 'open', 'second read'].includes(kind)));

  f.ui.scheduleMine = false;
  f.ui.scheduleDate = '2026-11-21';
  const fresh = f.refresh();
  assert.equal(f.requests.length, 2);
  f.requests[1].finish(4);
  await fresh;
  assert.equal(f.revision, 4);
  assert.equal(f.sync.hidden, true);
  assert.equal(f.ui.toolUpdatePending, false);
  assert.deepEqual(f.events.filter(([kind]) => ['render', 'open'].includes(kind)), [['render', 4], ['open', f.scope, true]]);
  assert.ok(f.events.every(([kind]) => kind !== 'second read'));
});

test('a single unchanged but verified read can rebuild a stale run sheet without a second read', async () => {
  const f = fixture();
  const pending = f.refresh();
  f.requests[0].finish(1, { changed: false, verified: true });
  await pending;
  assert.equal(f.revision, 1);
  assert.equal(f.requests.length, 1);
  assert.equal(f.sync.hidden, true);
  assert.deepEqual(f.events.filter(([kind]) => ['render', 'open', 'second read'].includes(kind)), [['render', 1], ['open', f.scope, true]]);
});

test('hidden or replaced run sheets cannot publish a refresh or discard the known warning', async () => {
  const hidden = fixture();
  hidden.document.hidden = true;
  await hidden.refresh();
  assert.equal(hidden.requests.length, 0);
  for (const change of [f => { f.document.hidden = true; }, f => { f.ui.runSheet = { ...f.snapshot }; }, f => f.replaceTitle(),
    f => { f.ui.dialogKind = 'task'; }, f => { f.ui.view = 'tasks'; }, f => { f.ui.timelineMode = 'deadlines'; },
    f => { f.window.GatherAccessLost = true; }, f => { f.ui.pendingSave = true; }, f => { f.backdrop.hidden = true; },
    f => { f.ui.actor = 'dev'; }, f => { f.window.GatherMode.projectId = 'other'; }]) {
    const f = fixture();
    const pending = f.refresh();
    assert.equal(f.requests.length, 1);
    change(f);
    assert.equal(f.requests[0].canApply(3), false);
    f.requests[0].finish(3);
    await pending;
    assert.equal(f.revision, 1);
    assert.equal(f.sync.hidden, false);
    assert.equal(f.busyRunSheetRevisions.size, 0);
    if(f.document.hidden)assert.match(f.status.textContent,/Refresh paused.*Try again/);
    if(f.window.GatherAccessLost||f.ui.actor==='dev'||f.window.GatherMode.projectId==='other')
      assert.equal(f.known,1,'a superseded workspace must not inherit another workspace revision floor');
    assert.ok(f.events.every(([kind]) => !['render', 'open', 'second read'].includes(kind)));
  }
});

test('unverified results or read failures keep stale output blocked for another attempt', async () => {
  for (const fail of [false, true]) {
    const f = fixture();
    const pending = f.refresh();
    if (fail) f.requests[0].reject(new Error('Fictional read failure'));
    else f.requests[0].finish(1, { changed: false });
    await pending;
    assert.equal(f.revision, 1);
    assert.equal(f.sync.hidden, false);
    assert.equal(f.busyRunSheetRevisions.size, 0);
    assert.match(f.status.textContent, /try again/i);
    assert.ok(f.events.every(([kind]) => !['render', 'open', 'second read'].includes(kind)));
  }
});
