import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/priorities.js';
import '../legacy/schedule-ui.js';
import '../legacy/recovery-ui.js';

const owner = 'maya', otherOwner = 'dev';
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const former = { start: '2099-10-21T11:00', end: '', location: 'Former <fixture> hall' };
const current = { start: '2099-10-21T13:00', end: '', location: 'Current & hall' };
const action = 'review-schedule-reconfirmation';
const forBothPanels = (s, assertions, actor = owner) => {
  const ui = GatherRecoveryUI.create({ store: { getState: () => s }, ui: { actor }, h, options: () => '', dayLabel: h, member: id => ({ name: id }) });
  for (const overview of [false, true]) assertions(ui.nextUpPanel(s, { overview }));
};
const rows = (html, id) => [...html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/g)]
  .map(match => match[0]).filter(row => row.includes('data-id="' + id + '"'));
const buttons = (html, type) => [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0])
  .filter(button => button.includes('data-action="' + type + '"'));
const suggestionIds = html => [...(html.match(/<details data-next-up-suggestions\b[^>]*>[\s\S]*?<\/details>/)?.[0] ?? '')
  .matchAll(/data-id="([^"]+)"/g)].map(match => match[1]);

function fixture() {
  const store = GatherStore.createStore({ storage: null });
  store.completeSetup({ timeZone: 'America/Los_Angeles' });
  const ids = new Set();
  function add(title, fields = {}) {
    const result = store.addTask({ title, owner, ...fields });
    ids.add(result.id);
    return result.id;
  }
  function changed(title, fields = {}) {
    const id = add(title, { schedule: former, ...fields });
    store.acceptTask(id, fields.owner || owner);
    store.setTaskSchedule(id, current);
    return id;
  }
  const get = id => store.getState().tasks.find(task => task.id === id);
  const view = () => {
    const state = store.getState();
    return { ...state, tasks: state.tasks.filter(task => ids.has(task.id)) };
  };
  const commit = id => store.setNextUp(id, { enabled: true }, owner);
  return { store, add, changed, get, view, commit };
}

test('blocked and ready schedule changes stay visible outside a full personal Next up without exposing the old slot', () => {
  const f = fixture();
  const blocked = f.changed('Blocked changed activity', { status: 'blocked' });
  const ready = f.changed('Ready changed activity');
  const other = f.changed('Different owner changed activity', { owner: otherOwner });
  const commitments = Array.from({ length: 3 }, (_, index) => f.add('Ordinary commitment ' + (index + 1)));
  commitments.forEach(f.commit);
  const before = f.store.exportState();
  forBothPanels(f.view(), html => {
    assert.match(html, /Schedule changes to review/);
    assert.match(html, /3\/3/);
    assert.deepEqual(suggestionIds(html), []);
    for (const id of [blocked, ready]) {
      const [row, ...duplicates] = rows(html, id);
      assert.ok(row);
      assert.deepEqual(duplicates, []);
      const [route] = buttons(row, action);
      assert.match(route, /data-next-up-origin="schedule-change"/);
      assert.match(route, new RegExp('data-id="' + id + '"'));
    }
    for (const id of commitments) assert.equal(rows(html, id).length, 1);
    assert.equal(rows(html, other).length, 0);
    assert.doesNotMatch(html, /Different owner|Former &lt;fixture&gt; hall|11:00 AM|<form|data-action="(?:claim|accept-task|toggle-task)"/);
  });
  assert.equal(f.store.exportState(), before);
  assert.equal(f.get(blocked).status, 'blocked');
  assert.equal(f.get(ready).acceptedAt, '');
  assert.equal(f.get(ready).nextUpAt, '');
});

test('schedule changes are filtered before suggestion capacity is sliced, leaving room for ordinary candidates', () => {
  const f = fixture();
  const changed = f.changed('Urgent schedule change');
  f.store.setTaskPriority(changed, { priority: 'high' });
  const ordinary = Array.from({ length: 3 }, (_, index) => f.add('Suggested ordinary task ' + index));
  forBothPanels(f.view(), html => {
    assert.match(html, /0\/3/);
    assert.equal(rows(html, changed).length, 1);
    assert.equal(buttons(html, action).length, 1);
    assert.deepEqual(new Set(suggestionIds(html)), new Set(ordinary));
  });
});

test('returned reports and pending requests keep their primary row and gain only one schedule-review action', () => {
  const f = fixture();
  const help = f.changed('Changed schedule with help requested');
  f.store.requestRecovery(help, { kind: 'help', note: 'Private request reason' }, owner);
  const date = f.changed('Changed schedule with date proposed');
  f.store.requestRecovery(date, { kind: 'date', note: 'Private proposal reason', proposedDate: '2099-10-30' }, owner);
  const returned = f.add('Changed schedule with returned report', { schedule: former, requiresVerification: true });
  f.store.reportCompletion(returned, 'Private submitted result', owner);
  f.store.returnCompletion(returned, 'Private organizer feedback');
  f.store.acceptTask(returned, owner);
  f.store.setTaskSchedule(returned, current);
  assert.ok(f.get(returned).scheduleReconfirmation, 'returned fixture also requires schedule review');
  forBothPanels(f.view(), html => {
    for (const id of [help, date, returned]) {
      const [row, ...duplicates] = rows(html, id);
      assert.ok(row);
      assert.deepEqual(duplicates, []);
      assert.equal(buttons(row, action).length, 1);
    }
    assert.match(rows(html, help)[0], /data-open-recovery[\s\S]*Help request awaiting review/);
    assert.match(rows(html, date)[0], /data-open-recovery[\s\S]*Date proposal awaiting review/);
    assert.match(rows(html, returned)[0], /data-action="review-returned-completion"[\s\S]*Review and revise/);
    assert.doesNotMatch(html, /Private request reason|Private proposal reason|Private submitted result|Private organizer feedback|Former &lt;fixture&gt; hall/);
  });
});

test('the personal review action disappears once the current owner accepts, is replaced, reports, or finishes', () => {
  for (const [name, resolve] of [
    ['acceptance', (f, id) => f.store.acceptTask(id, owner)],
    ['reassignment', (f, id) => f.store.updateTask(id, { owner: otherOwner })],
    ['report', (f, id) => f.store.reportCompletion(id, 'Fictional result', owner)],
    ['done', (f, id) => f.store.updateTask(id, { status: 'done' })],
  ]) {
    const f = fixture();
    const id = f.changed('Needs schedule reconfirmation', { requiresVerification: name === 'report' });
    forBothPanels(f.view(), html => assert.equal(buttons(html, action).length, 1, name));
    resolve(f, id);
    forBothPanels(f.view(), html => assert.equal(buttons(html, action).length, 0, name));
    forBothPanels(f.view(), html => assert.equal(buttons(html, action).length, 0, name), otherOwner);
  }
});

function reviewRoute({ overview = false } = {}) {
  const f = fixture(), id = f.changed('Activity to reconfirm');
  const source = readFileSync('legacy/app.js', 'utf8');
  const start = source.indexOf('  function openScheduleReconfirmation('), end = source.indexOf('  function timelineOverlapIntent(', start);
  assert.ok(start >= 0 && end > start);
  const ui = { actor: owner, view: overview ? 'overview' : 'tasks', tab: 'mine', dialogKind: '', detailId: '' };
  const window = { GatherMode: { projectId: 'fictional-project' }, GatherAccessLost: false };
  const calls = [], frames = [];
  const backdrop = { hidden: true }, dialog = {}, root = {}, heading = { id: 'taskScheduleReconfirmation' };
  const opener = { isConnected: true, dataset: { id, action, nextUpOrigin: 'schedule-change' }, closest: () => null };
  const panel = { dataset: { nextUpPanel: overview ? 'overview' : 'mine', nextUpActor: owner }, contains: candidate => candidate === opener };
  let title = {}, workspacePending = false;
  const context = vm.createContext({ ui, window, store: f.store, GatherScheduleUI,
    $: (selector, parent) => {
      if (selector === '#dialogTitle' || selector === '#taskScheduleReconfirmation') assert.equal(parent, dialog);
      return ({ '#dialogBackdrop': backdrop, '#dialog': dialog, '#viewRoot': root, '#dialogTitle': title, '#taskScheduleReconfirmation': heading })[selector];
    },
    currentNextUpPanel(candidate) { assert.equal(candidate, root); return panel; },
    workspaceUpdatesPending: () => workspacePending,
    showPendingUpdate: () => calls.push(['pending update']),
    render: () => calls.push(['render']), toast: message => calls.push(['toast', message]),
    taskDialog(...args) { calls.push(['dialog', ...args]); backdrop.hidden = false; ui.dialogKind = 'task'; ui.detailId = args[0]; },
    requestAnimationFrame: callback => frames.push(callback),
    focusTaskDialogControl: (target, container) => calls.push(['focus', target, container]),
  });
  vm.runInContext(source.slice(start, end), context);
  return { f, id, ui, window, backdrop, dialog, heading, opener, panel, calls, frames,
    replaceTitle() { title = {}; },
    set workspacePending(value) { workspacePending = value; },
    run: (taskId = id, button = opener) => context.openScheduleReconfirmation(taskId, button),
    flush() { for (const frame of frames.splice(0)) frame(); },
  };
}

test('review opens the exact owner-scoped activity, preserves the return opener, and focuses the comparison without auto-search', () => {
  for (const overview of [false, true]) {
    const r = reviewRoute({ overview }), before = r.f.store.exportState();
    assert.equal(r.run(), true);
    assert.equal(r.calls.length, 1);
    assert.deepEqual(r.calls[0].slice(0, -1), ['dialog', r.id, '', false, true, '', undefined, '']);
    assert.equal(r.calls[0].at(-1).readOnly, true);
    assert.equal(r.ui.lastFocus, r.opener);
    r.flush();
    assert.deepEqual(r.calls[1], ['focus', r.heading, r.dialog]);
    assert.equal(r.f.store.exportState(), before);
  }
  for (const invalidate of [
    r => { r.ui.tab = 'all'; }, r => { r.ui.actor = otherOwner; }, r => { r.panel.dataset.nextUpActor = otherOwner; },
    r => { r.panel.dataset.nextUpPanel = 'overview'; }, r => { r.opener.isConnected = false; },
    r => { r.opener.closest = () => ({}); }, r => { r.backdrop.hidden = false; },
  ]) {
    const r = reviewRoute();
    invalidate(r);
    assert.equal(r.run(), false);
    assert.deepEqual(r.calls, []);
  }
  const stale = reviewRoute();
  stale.f.store.acceptTask(stale.id, owner);
  assert.equal(stale.run(), false);
  assert.deepEqual(stale.calls.map(([kind]) => kind), ['render', 'toast']);
});

test('delayed comparison focus cannot target another dialog, actor or project', () => {
  for (const invalidate of [
    r => { r.ui.actor = otherOwner; }, r => { r.window.GatherMode.projectId = 'other-project'; },
    r => r.replaceTitle(), r => { r.ui.detailId = 'different-task'; }, r => { r.ui.dialogKind = 'notifications'; },
    r => { r.backdrop.hidden = true; }, r => { r.window.GatherAccessLost = true; },
  ]) {
    const r = reviewRoute();
    assert.equal(r.run(), true);
    assert.equal(r.frames.length, 1);
    invalidate(r);
    r.flush();
    assert.deepEqual(r.calls.map(([kind]) => kind), ['dialog']);
  }
});

test('known newer workspace data blocks opening or defers focusing the saved comparison', () => {
  const beforeOpen = reviewRoute();
  beforeOpen.workspacePending = true;
  assert.equal(beforeOpen.run(), false);
  assert.deepEqual(beforeOpen.calls.map(([kind]) => kind), ['toast']);
  assert.match(beforeOpen.calls[0][1], /New project updates.*Refresh the project/);
  assert.equal(beforeOpen.frames.length, 0);

  const duringOpen = reviewRoute();
  assert.equal(duringOpen.run(), true);
  duringOpen.workspacePending = true;
  duringOpen.flush();
  assert.deepEqual(duringOpen.calls.map(([kind]) => kind), ['dialog', 'pending update']);
  assert.equal(duringOpen.ui.lastFocus, duringOpen.opener);

  const replaced = reviewRoute();
  assert.equal(replaced.run(), true);
  replaced.workspacePending = true;
  replaced.replaceTitle();
  replaced.flush();
  assert.deepEqual(replaced.calls.map(([kind]) => kind), ['dialog'], 'a replaced dialog does not inherit the earlier warning callback');
});
