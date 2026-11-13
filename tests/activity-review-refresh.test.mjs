import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('legacy/app.js', 'utf8');
const id = 'fictional-activity';
const day = '2026-11-20';

function fixture() {
  const ui = { view: 'timeline', timelineMode: 'schedule', scheduleMine: true, scheduleDate: day,
    overlapReviewDay: day, actor: 'jack', dialogKind: 'task', detailId: id, toolUpdatePending: true,
    overlapComparison: { originId: 'fictional-original', peerId: id } };
  const window = { GatherMode: { projectId: 'fictional' } };
  const document = { hidden: false, activeElement: null };
  const dialog = {}, backdrop = { hidden: false }, sync = { hidden: false };
  const status = { textContent: '', setAttribute() {}, removeAttribute() {} };
  const calls = [], requests = [], frames = [];
  const activity = { id, title: 'Fictional arrival', schedule: { start: day + 'T09:00', end: day + 'T10:00', location: 'Hall' } };
  let revision = 3, newest = 4, task = activity, title = { name: 'task title' }, draft = '';
  const controls = new Map();
  function makeButton() {
    const attributes = new Map();
    return { name: 'refresh button', dataset: { id }, isConnected: true, attributes,
      setAttribute: (key, value) => attributes.set(key, value), getAttribute: key => attributes.get(key), removeAttribute: key => attributes.delete(key),
      focus: () => calls.push(['focus', 'refresh button']), closest: () => dialog };
  }
  let button = makeButton();
  let returnRoute = '';
  const read = () => ({ revision, tasks: task ? [task] : [] });
  const context = vm.createContext({ ui, window, document, requestAnimationFrame: cb => frames.push(cb),
    store: {
      getState: read,
      getSnapshotRevision: () => revision,
      refresh(canApply, options) {
        return new Promise((resolve, reject) => requests.push({ canApply, options, reject,
          finish(result = { changed: true, verified: true }, nextRevision = 4, nextTask = activity) {
            const allowed = canApply(nextRevision);
            if (allowed && result.changed) { revision = nextRevision; task = nextTask; }
            resolve(allowed ? result : { pending: true, newerRevision: nextRevision });
          },
        }));
      },
    },
    $: (selector, root) => ({
      '#dialog': dialog, '#dialogTitle': title, '#dialogBackdrop': backdrop, '#workspaceSyncNotice': sync,
      '#activityReviewRefreshStatus': status, '[data-action="refresh-activity-review"]': button,
      '#activityReviewRefresh': button, '#dialogStaleNotice': {},
    })[selector] ?? root?.controls?.get(selector) ?? controls.get(selector) ?? null,
    $$: () => [],
    hasUnsavedFields: () => !!draft,
    workspaceUpdatesPending: () => !sync.hidden,
    recoveryConflictPending: () => false,
    scheduleRevisionIsStale: value => value < newest,
    rememberNewerSchedule(_snapshot, value) { if (Number.isSafeInteger(value)) newest = Math.max(newest, value); },
    render: () => calls.push(['render', revision]),
    taskDialog(...args) { title = { name: 'rebuilt task title' }; calls.push(['task', ...args]); },
    focusTaskDialogControl: target => calls.push(['focus', target?.name]),
    closeDialog() { backdrop.hidden = true; ui.dialogKind = ''; calls.push(['close']); },
    returnToOverlapReview(readOnly) { calls.push(['return overlap', readOnly]); return returnRoute === 'overlap'; },
    returnToRelatedBatch(readOnly) { calls.push(['return batch', readOnly]); return returnRoute === 'batch'; },
    returnToAcceptanceReview() { calls.push(['return acceptance']); return returnRoute === 'acceptance'; },
    returnToEventTaskReview() { calls.push(['return event']); return returnRoute === 'event'; },
    showPendingUpdate() { sync.hidden = false; calls.push(['warning']); },
    toast: message => calls.push(['toast', message]),
  });
  return { ui, window, document, backdrop, sync, status, context, calls, requests, controls,
    get button() { return button; }, get revision() { return revision; },
    set draft(value) { draft = value; }, get draft() { return draft; },
    set newest(value) { newest = value; },
    set returnRoute(value) { returnRoute = value; },
    replaceHeading() { title = { name: 'replacement title' }; },
    replaceButton() { button.isConnected = false; button = makeButton(); },
    flush() { for (const frame of frames.splice(0)) frame(); },
  };
}

function load(f = fixture()) {
  const from = source.indexOf('  function canRefreshActivityReview(');
  const to = source.indexOf('  function showPendingUpdate(', from);
  assert.ok(from >= 0 && to > from, 'activity refresh handler is present');
  vm.runInContext(source.slice(from, to), f.context);
  f.refresh = (button = f.button) => f.context.refreshActivityReview(button);
  return f;
}

test('activity refresh requires one verified read and redraws the same activity without losing the return context', async () => {
  const f = load(), comparison = f.ui.overlapComparison;
  const pending = f.refresh();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].options.requireFresh, true);
  assert.equal(f.button.attributes.get('aria-disabled'), 'true');
  assert.match(f.status.textContent, /Refreshing activity review/);
  await f.refresh();
  assert.equal(f.requests.length, 1, 'a second click does not start another read');
  assert.equal(f.requests[0].canApply(4), true);
  f.requests[0].finish();
  await pending;
  f.flush();
  assert.equal(f.revision, 4);
  assert.equal(f.sync.hidden, true);
  assert.equal(f.button.attributes.has('aria-disabled'), false);
  assert.equal(f.ui.overlapComparison, comparison);
  assert.equal(f.ui.overlapReviewDay, day);
  assert.equal(f.ui.scheduleDate, day);
  assert.equal(f.ui.toolUpdatePending, false);
  assert.deepEqual(f.calls.filter(([kind]) => kind === 'render'), [['render', 4]]);
  const [, ...redraw] = f.calls.find(([kind]) => kind === 'task');
  assert.deepEqual(redraw.slice(0, -1), [id, '', true, true, '', undefined, '']);
  assert.deepEqual({ ...redraw.at(-1) }, { readOnly: true }, 'the refresh redraw must not trigger resource generation');
  assert.deepEqual(f.calls.filter(([kind]) => kind === 'focus'), [['focus', 'rebuilt task title']]);
});

test('unsaved activity edits block refresh without altering the draft, including edits made while the read is in flight', async () => {
  const f = load();
  f.draft = 'Initial unsaved schedule';
  await f.refresh();
  assert.equal(f.requests.length, 0);
  assert.match(f.status.textContent, /unsaved edits are still here/i);
  assert.equal(f.draft, 'Initial unsaved schedule');
  assert.equal(f.sync.hidden, false);
  f.draft = '';
  const pending = f.refresh();
  assert.equal(f.requests.length, 1);
  f.draft = 'An edit entered while the request was pending';
  assert.equal(f.requests[0].canApply(4), false);
  f.requests[0].finish();
  await pending;
  assert.equal(f.revision, 3);
  assert.equal(f.draft, 'An edit entered while the request was pending');
  assert.equal(f.sync.hidden, false);
  assert.match(f.status.textContent, /unsaved edits are still here/i);
  assert.ok(f.calls.every(([kind]) => !['render', 'task', 'close'].includes(kind)));
});

test('a refresh that is pending, unverified, below the known newer floor, or failed leaves the review in place', async () => {
  for (const scenario of ['pending', 'unverified', 'below floor', 'error']) {
    const f = load(), pending = f.refresh();
    if (scenario === 'pending') f.requests[0].finish({ pending: true, newerRevision: 5 });
    if (scenario === 'unverified') f.requests[0].finish({ changed: false });
    if (scenario === 'below floor') {
      f.newest = 5;
      assert.equal(f.requests[0].canApply(4), false, 'the known intermediate revision is rejected before publishing');
      assert.equal(f.requests[0].canApply(5), true, 'a verified candidate at the required floor may publish');
      f.requests[0].finish({ changed: true, verified: true }, 4);
    }
    if (scenario === 'error') f.requests[0].reject(new Error('Fictional offline failure'));
    await pending;
    f.flush();
    assert.equal(f.revision, 3, scenario);
    assert.equal(f.sync.hidden, false, scenario);
    assert.equal(f.button.attributes.has('aria-disabled'), false, scenario);
    assert.match(f.status.textContent, /current view is unchanged.*Try again/, scenario);
    assert.ok(f.calls.every(([kind]) => !['task', 'close'].includes(kind)), scenario);
  }
});

test('a late read cannot apply after the activity review is replaced, hidden, or leaves its scope', async () => {
  for (const change of [f => f.replaceHeading(), f => f.replaceButton(), f => { f.ui.view = 'overview'; },
    f => { f.ui.detailId = 'different task'; }, f => { f.ui.actor = 'maya'; }, f => { f.window.GatherMode.projectId = 'other'; },
    f => { f.window.GatherAccessLost = true; }, f => { f.document.hidden = true; }, f => { f.ui.pendingSave = true; },
    f => { f.ui.scheduleDate = '2026-11-21'; }, f => { f.ui.scheduleMine = false; }, f => { f.ui.timelineMode = 'deadlines'; },
    f => { f.ui.overlapReviewDay = '2026-11-21'; }, f => { f.ui.overlapComparison = { ...f.ui.overlapComparison }; }]) {
    const f = load(), pending = f.refresh();
    assert.equal(f.requests.length, 1);
    change(f);
    assert.equal(f.requests[0].canApply(4), false);
    f.requests[0].finish();
    await pending;
    f.flush();
    assert.equal(f.revision, 3);
    assert.equal(f.sync.hidden, false);
    assert.ok(f.calls.every(([kind]) => !['render', 'task', 'close', 'focus'].includes(kind)));
  }
});

test('a verified refresh that removes the activity closes instead of reopening stale task details', async () => {
  for (const [route, expected] of [
    ['overlap', [['return overlap', true]]],
    ['batch', [['return overlap', true], ['return batch', true]]],
    ['acceptance', [['return overlap', true], ['return batch', true], ['return acceptance']]],
    ['event', [['return overlap', true], ['return batch', true], ['return acceptance'], ['return event']]],
    ['', [['return overlap', true], ['return batch', true], ['return acceptance'], ['return event'], ['close']]],
  ]) {
    const f = load();
    f.returnRoute = route;
    f.ui.relatedBatch = { childId: id };
    f.ui.acceptanceReturn = { openerId: id };
    const pending = f.refresh();
    f.requests[0].finish({ changed: true, verified: true }, 4, null);
    await pending;
    f.flush();
    assert.equal(f.revision, 4);
    assert.equal(f.sync.hidden, true);
    assert.deepEqual(f.calls.filter(([kind]) => kind.startsWith('return') || kind === 'close'), expected);
    assert.ok(f.calls.every(([kind]) => kind !== 'task'));
  }
});

test('a clean redraw focuses an open overlap summary and does not steal focus after another dialog opens', async () => {
  for (const replaced of [false, true]) {
    const f = load();
    f.controls.set('[data-schedule-overlap-kind][open] summary', { name: 'open overlap summary' });
    const pending = f.refresh();
    f.requests[0].finish();
    await pending;
    if (replaced) f.replaceHeading();
    f.flush();
    assert.deepEqual(f.calls.filter(([kind]) => kind === 'focus'), replaced ? [] : [['focus', 'open overlap summary']]);
  }
});

test('only an eligible activity review with its current stale-warning button can start the read', async () => {
  const f = load();
  assert.equal(f.context.canRefreshActivityReview({ schedule: {} }), true);
  assert.match(f.context.activityReviewRefreshNotice(), /Refresh activity review/);
  const old = f.button;
  f.replaceButton();
  await f.refresh(old);
  await f.refresh({ ...f.button, isConnected: true });
  f.sync.hidden = true;
  await f.refresh();
  f.sync.hidden = false;
  f.ui.overlapComparison = null;
  f.ui.overlapReviewDay = '';
  assert.equal(f.context.canRefreshActivityReview({ eventActivity: true }), true);
  assert.equal(f.context.canRefreshActivityReview({}), false);
  f.ui.view = 'tasks';
  assert.equal(f.context.canRefreshActivityReview({ schedule: {} }), false);
  await f.refresh();
  assert.equal(f.requests.length, 0);
});
