import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('legacy/app.js', 'utf8');
function fragment(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}

function fixture() {
  const ui = { view: 'timeline', dialogKind: 'before-event-review', actor: 'jack', timelineMode: 'schedule', scheduleMine: true, scheduleDate: '2026-11-20' };
  const window = {}, sync = { hidden: false }, backdrop = { hidden: false }, dialog = {};
  const events = [], requests = [];
  const status = { textContent: '', setAttribute() {}, removeAttribute() {} };
  const attributes = new Map();
  const control = { isConnected: true, setAttribute: (key, value) => attributes.set(key, value), getAttribute: key => attributes.get(key),
    removeAttribute: key => attributes.delete(key), focus: () => events.push(['refresh focus']) };
  let title = {}, snapshot = 'original';
  const ctx = vm.createContext({
    ui, window, document: { hidden: false, activeElement: null },
    store: {
      getState: () => ({ snapshot, tasks: [] }), getSnapshotRevision: () => snapshot === 'fresh' ? 4 : 3,
      refresh(canApply,options) {
        return new Promise((resolve, reject) => requests.push({
          canApply:()=>canApply(4),options,
          finish(result = { changed: true, verified: true }) {
            const allowed = canApply(result.changed?4:3);
            if (allowed && result.changed) snapshot = 'fresh';
            resolve(allowed ? result : { pending: true });
          },
          reject,
        }));
      },
    },
    $: selector => ({
      '#workspaceSyncNotice': sync, '#dialogTitle': title, '#dialogBackdrop': backdrop, '#dialog': dialog,
      '#dialogStaleNotice': {}, '#eventReviewRefreshStatus': status,
      '[data-action="refresh-event-review"]': control,
    })[selector] ?? null,
    GatherRecoveryUI: { organizerReviews: () => ['help', 'date', 'completion'].map(kind => ({ task: { id: kind }, kind })) },
    isOrganizer: () => true,
    scheduleWorkspaceKey: () => JSON.stringify([window.GatherMode?.projectId,ui.actor]),
    taskDialog: (...args) => events.push(['taskDialog', ...args]),
    beforeEventReview: group => events.push(['beforeEventReview', group, snapshot]),
    render: () => events.push(['render', snapshot]),
    toast: message => events.push(['toast', message]),
    showPendingUpdate: () => { sync.hidden = false; },
    rememberNewerSchedule: () => {},
    scheduleRevisionIsStale: revision => revision < 4,
    requestAnimationFrame: () => {},
  });
  const refresh = group => ctx.refreshBeforeEventReview(group);
  return { ctx, ui, window, sync, status, attributes, events, requests, refresh, reopen: () => { title = {}; } };
}

function load(f) {
  vm.runInContext(fragment('  function openOrganizerReview(', '  function focusTaskRecovery('), f.ctx);
  vm.runInContext(fragment('  function eventReviewScope(', '  function beforeEventReview('), f.ctx);
  vm.runInContext(fragment('  function workspaceUpdatesPending(', '\n  }') + '\n  }', f.ctx);
  vm.runInContext(fragment('  async function refreshBeforeEventReview(', '\n  }') + '\n  }', f.ctx);
  return f;
}

test('a recovery write conflict requires a newer revision before refreshing the event review',()=>{
  const required=[];
  let warned=0,revision=12;
  const ctx=vm.createContext({ui:{},$ :()=>({hidden:true}),store:{getSnapshotRevision:()=>revision},
    rememberNewerSchedule:(snapshot,revision)=>required.push([snapshot,revision]),showPendingUpdate:()=>warned++});
  vm.runInContext(fragment('  function workspaceUpdatesPending(', '  function eventReviewRefreshNotice('),ctx);
  vm.runInContext(fragment('  function showRecoveryWriteConflict(', '  let staleScheduleRevision'),ctx);
  ctx.showRecoveryWriteConflict();
  assert.deepEqual(required,[[null,13]]);
  assert.equal(warned,1);
  assert.equal(ctx.workspaceUpdatesPending(),true,'an unchanged read cannot clear the conflict');
  revision++;
  assert.equal(ctx.workspaceUpdatesPending(),false);
});

test('known-stale recovery rows cannot open a decision from Before the event', () => {
  const { ctx, ui, sync, events } = load(fixture());
  assert.equal(ctx.workspaceUpdatesPending(), true);
  for (const kind of ['help', 'date']) {
    assert.equal(ctx.openOrganizerReview(kind, kind, 'plan-requests'), false);
    assert.ok(events.some(event => event[0] === 'beforeEventReview' && event[1] === 'plan-requests'));
    assert.ok(events.every(event => event[0] !== 'taskDialog'));
    events.length = 0;
  }
  assert.equal(ctx.openOrganizerReview('completion', 'completion', 'verification'), true);
  assert.deepEqual(events.shift(), ['taskDialog', 'completion', '', false, false, 'verification']);

  sync.hidden = true;
  assert.equal(ctx.workspaceUpdatesPending(), false);
  assert.equal(ctx.openOrganizerReview('help', 'help', 'plan-requests'), true);
  assert.deepEqual(events.shift(), ['taskDialog', 'help', '', false, false, 'plan-requests']);
  ui.dialogKind = '';
  sync.hidden = false;
  assert.equal(ctx.openOrganizerReview('date', 'date'), true, 'the gate is specific to Before the event');
});

test('refresh applies a single read and reopens the same event review group with current facts', async () => {
  const { ctx, ui, sync, status, attributes, events, requests, refresh } = load(fixture());
  const first = refresh('plan-requests');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.requireFresh,true);
  assert.equal(ui.syncing, true);
  assert.equal(attributes.get('aria-disabled'), 'true');
  assert.match(status.textContent, /Refreshing event review/);
  assert.equal(ctx.openOrganizerReview('help','help','plan-requests'),false);
  assert.deepEqual(events,[['refresh focus']],'another stale request cannot replace the refresh in flight');
  await refresh('plan-requests');
  assert.equal(requests.length, 1, 'repeated activation does not start another refresh');
  assert.equal(requests[0].canApply(), true);
  requests[0].finish();
  await first;
  assert.equal(ui.syncing, false);
  assert.equal(attributes.has('aria-disabled'), false);
  assert.equal(sync.hidden, true);
  assert.deepEqual(events.filter(event => event[0] === 'beforeEventReview'), [['beforeEventReview', 'plan-requests', 'fresh']]);
  assert.deepEqual({ actor: ui.actor, mode: ui.timelineMode, mine: ui.scheduleMine, date: ui.scheduleDate }, { actor: 'jack', mode: 'schedule', mine: true, date: '2026-11-20' });
});

test('pending or failed refresh keeps the warning and existing review open for retry', async () => {
  for (const outcome of ['pending', 'same stale snapshot', 'error']) {
    const { ui, sync, status, attributes, events, requests, refresh } = load(fixture());
    const current = refresh('plan-requests');
    if (outcome === 'pending') requests[0].finish({ pending: true, newerRevision: 4 });
    else if (outcome === 'same stale snapshot') requests[0].finish({ changed: false });
    else requests[0].reject(new Error('Fictional network failure'));
    await current;
    assert.equal(ui.syncing, false, outcome);
    assert.equal(sync.hidden, false, outcome);
    assert.equal(ui.dialogKind, 'before-event-review', outcome);
    assert.equal(attributes.has('aria-disabled'), false, outcome);
    assert.match(status.textContent, /current view is unchanged.*Try again/, outcome);
    assert.ok(events.every(event => event[0] !== 'beforeEventReview' && event[0] !== 'render'), outcome);
  }
});

test('late refresh cannot replace a reopened dialog, a different actor, or another timeline scope', async () => {
  for (const transition of [
    f => { f.reopen(); },
    f => { f.ui.dialogKind = 'task'; },
    f => { f.ui.view = 'overview'; },
    f => { f.ctx.document.hidden = true; },
    f => { f.ui.actor = 'maya'; },
    f => { f.ui.scheduleMine = false; },
    f => { f.ui.scheduleDate = '2026-11-21'; },
    f => { f.window.GatherMode = {projectId:'a-different-project'}; },
    f => { f.window.GatherAccessLost = true; },
  ]) {
    const f = load(fixture());
    const current = f.refresh('plan-requests');
    transition(f);
    assert.equal(f.requests[0].canApply(), false);
    f.requests[0].finish();
    await current;
    assert.equal(f.ui.syncing, false);
    assert.equal(f.sync.hidden, false);
    assert.deepEqual(f.events, []);
  }
});

test('an explicit event review check still runs if an ambient refresh cleared the shared banner',async()=>{
  const f=load(fixture());
  f.sync.hidden=true;
  const key=f.ctx.scheduleWorkspaceKey();
  f.ui.eventScheduleCheckKey=key;
  const checking=f.refresh('activity-details');
  assert.equal(f.requests.length,1);
  f.requests[0].finish();
  await checking;
  assert.equal(f.ui.eventScheduleCheckKey,undefined);
  assert.ok(f.events.some(event=>event[0]==='beforeEventReview'&&event[1]==='activity-details'));
});
