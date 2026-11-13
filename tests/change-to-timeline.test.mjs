import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/schedule-ui.js';

const source = readFileSync('legacy/app.js', 'utf8');
const actor = 'maya', zone = 'America/Los_Angeles';
const oldDay = '2099-10-20', currentDay = '2099-10-21';
const previousSlot = { start: oldDay + 'T20:00', end: oldDay + 'T21:00', location: 'Earlier fictional hall' };
const currentSlot = { start: currentDay + 'T23:15', end: '2099-10-22T02:00', location: 'Current fictional hall' };
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function fragment(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}

function fixture({ view = 'overview', current = currentSlot } = {}) {
  const store = GatherStore.createStore({ storage: null });
  store.completeSetup({ timeZone: zone });
  const id = store.addTask({ title: 'Fictional <activity>', owner: actor, schedule: previousSlot, eventActivity: true }).id;
  store.acceptTask(id, actor);
  store.setTaskSchedule(id, current);
  const get = () => store.getState().tasks.find(task => task.id === id);
  const ui = { view, actor, tab: 'mine', detailId: id, dialogKind: 'task', scheduleDate: oldDay, scheduleMine: true, timelineMode: 'deadlines' };
  const window = { GatherMode: { projectId: 'fictional-project' }, GatherAccessLost: false };
  const document = { hidden: false, activeElement: null };
  const backdrop = { hidden: false }, calls = [];
  let hidden = false, disabled = false, stale = false, pending = false, canLeave = true, canClose = true, canDiscard = true;
  let dateDraft = false, partialDate = false, canReplaceDate = true;
  let beforeTransition = () => {};
  const comparison = { id: 'taskScheduleReconfirmation' };
  const title = { id: 'dialogTitle' };
  const opener = { id: 'reconfirmationTimelineDay', isConnected: true,
    dataset: { id, action: 'show-reconfirmed-activity-day', day: currentDay, revision: String(get().revision), zone },
    matches: selector => selector === ':disabled' && disabled, closest: () => hidden ? {} : null };
  let currentOpener = opener;
  window.confirm = message => { calls.push(['confirm-date', message]); return canReplaceDate; };
  const dialog = { id: 'dialog', contains: el => el === currentOpener || el === comparison || el === title };
  const context = vm.createContext({ ui, window, document, store, h, GatherScheduleUI,
    schedule: GatherScheduleUI.create({ h, options: () => '', statusBadge: h }),
    $: selector => ({ '#dialogBackdrop': backdrop, '#dialog': dialog, '#dialogTitle': title,
      '#taskScheduleReconfirmation': comparison, '#reconfirmationTimelineDay': currentOpener })[selector] ?? null,
    workspaceUpdatesPending: () => pending, scheduleRevisionIsStale: () => stale,
    captureScheduleDateDraft: () => dateDraft, hasPartialScheduleDate: () => partialDate,
    confirmCloseDialog() { calls.push('confirm-close'); return canClose; },
    confirmDiscard() { calls.push('confirm-discard'); return canDiscard; },
    closeDialog() { calls.push('close'); backdrop.hidden = true; ui.dialogKind = ''; },
    navigate(next, { scheduleDay, beforeRender } = {}) {
      calls.push('navigate-guard');
      if (!canLeave) return false;
      beforeTransition();
      if (beforeRender && !beforeRender()) return false;
      calls.push(['render-timeline', scheduleDay]);
      ui.view = next; ui.scheduleDate = scheduleDay; ui.timelineMode = 'schedule';
      return true;
    },
    focusTimelineRow(taskId, day) { calls.push(['focus-timeline-row', taskId, day]); return true; },
    render: () => calls.push('render'), toast: value => calls.push(['toast', value]),
  });
  vm.runInContext(fragment('  function reconfirmationTimelineAction(', '  function timelineOverlapIntent('), context);
  return { id, ui, window, document, store, get, backdrop, opener, calls,
    set hidden(value) { hidden = value; }, set disabled(value) { disabled = value; }, set stale(value) { stale = value; },
    set pending(value) { pending = value; }, set canLeave(value) { canLeave = value; }, set canClose(value) { canClose = value; },
    set canDiscard(value) { canDiscard = value; }, set beforeTransition(value) { beforeTransition = value; },
    set dateDraft(value) { dateDraft = value; }, set partialDate(value) { partialDate = value; },
    set canReplaceDate(value) { canReplaceDate = value; },
    replace() { currentOpener = { ...opener }; },
    markup(task = get(), state = store.getState()) { return context.reconfirmationTimelineAction(task, state); },
    run(taskId = id, button = opener) { return context.showReconfirmedActivityDay(taskId, button); },
  };
}

test('schedule comparison offers the current event-local day only for a pending scheduled activity owned by the viewer', () => {
  const f = fixture(), state = f.store.getState(), task = f.get(), before = f.store.exportState();
  const html = f.markup();
  const tag = html.match(/<button[^>]*>/)?.[0];
  assert.match(tag, /id="reconfirmationTimelineDay"/);
  assert.match(tag, /data-action="show-reconfirmed-activity-day"/);
  assert.ok(tag.includes(`data-id="${f.id}"`));
  assert.ok(tag.includes(`data-day="${currentDay}"`));
  assert.ok(tag.includes(`data-revision="${task.revision}"`));
  assert.ok(tag.includes(`data-zone="${zone}"`));
  assert.match(html, /Show current day in Timeline/);
  assert.doesNotMatch(html, /Earlier fictional hall|Current fictional hall|2099-10-20|2099-10-22|type="submit"/);
  for (const row of [{ ...task, owner: 'dev' }, { ...task, acceptedAt: '2030-01-01T00:00Z' },
    { ...task, reportedAt: '2030-01-01T00:00Z' }, { ...task, archivedAt: '2030-01-01T00:00Z' },
    { ...task, status: 'done' }, { ...task, schedule: null }]) assert.equal(f.markup(row, state), '');
  assert.equal(f.store.exportState(), before);
});

test('opening the current day keeps activity scope, closes only after the navigation guard, and never accepts the assignment', () => {
  for (const view of ['overview', 'tasks']) {
    const f = fixture({ view }), before = f.store.exportState();
    assert.equal(f.run(), true);
    assert.ok(f.calls.includes('confirm-close'));
    assert.ok(f.calls.includes('confirm-discard'));
    assert.ok(f.calls.indexOf('navigate-guard') < f.calls.indexOf('close'));
    assert.deepEqual(f.calls.slice(-2), [['render-timeline', currentDay], ['focus-timeline-row', f.id, currentDay]]);
    assert.equal(f.ui.scheduleDate, currentDay);
    assert.equal(f.ui.scheduleMine, true);
    assert.equal(f.ui.timelineMode, 'schedule');
    assert.equal(f.store.exportState(), before);
    assert.ok(f.get().scheduleReconfirmation);
    assert.equal(f.get().acceptedAt, '');
  }
});

test('stale controls, other reviews, and changed task facts cannot leave the comparison', () => {
  for (const [reason, mutate] of Object.entries({
    'detached control': f => { f.opener.isConnected = false; },
    'replaced control': f => f.replace(),
    'hidden control': f => { f.hidden = true; },
    'hidden document': f => { f.document.hidden = true; },
    'disabled control': f => { f.disabled = true; },
    'incorrect day': f => { f.opener.dataset.day = oldDay; },
    'incorrect revision': f => { f.opener.dataset.revision = '1'; },
    'incorrect zone': f => { f.opener.dataset.zone = 'UTC'; },
    'stale workspace': f => { f.stale = true; },
    'newer workspace': f => { f.pending = true; },
    'saving': f => { f.ui.pendingSave = true; },
    'access loss': f => { f.window.GatherAccessLost = true; },
    'different actor': f => { f.ui.actor = 'dev'; },
    'another task': f => { f.ui.detailId = 'different'; },
    'closed dialog': f => { f.backdrop.hidden = true; },
    'event review': f => { f.ui.eventTaskReview = {}; },
    'overlap review': f => { f.ui.overlapComparison = {}; },
    'assignment review': f => { f.ui.acceptanceReturn = {}; },
    'related review': f => { f.ui.relatedBatch = {}; },
    'already accepted': f => f.store.acceptTask(f.id, actor),
    'changed slot': f => f.store.setTaskSchedule(f.id, previousSlot),
    'removed slot': f => f.store.setTaskSchedule(f.id, null),
  })) {
    const f = fixture();
    mutate(f);
    const before = f.store.exportState();
    assert.equal(f.run(), false, reason);
    assert.ok(!f.calls.includes('close'), reason);
    assert.ok(!f.calls.some(call => call[0] === 'focus-timeline-row'), reason);
    assert.equal(f.ui.scheduleDate, oldDay, reason);
    assert.equal(f.store.exportState(), before, reason);
  }
});

test('discard or sidebar veto and a changed comparison during the transition leave the dialog intact', () => {
  for (const [reason, mutate] of Object.entries({
    'close veto': f => { f.canClose = false; },
    'discard veto': f => { f.canDiscard = false; },
    'sidebar veto': f => { f.canLeave = false; },
    'changed before transition': f => { f.beforeTransition = () => { f.ui.detailId = 'different'; }; },
    'access loss before transition': f => { f.beforeTransition = () => { f.window.GatherAccessLost = true; }; },
    'hidden before transition': f => { f.beforeTransition = () => { f.document.hidden = true; }; },
  })) {
    const f = fixture();
    mutate(f);
    assert.equal(f.run(), false, reason);
    assert.equal(f.backdrop.hidden, false, reason);
    assert.ok(!f.calls.includes('close'), reason);
    assert.equal(f.ui.view, 'overview', reason);
    assert.equal(f.ui.scheduleDate, oldDay, reason);
  }
});

test('a typed but unapplied Timeline date requires explicit permission to replace', () => {
  for (const kind of ['dateDraft', 'partialDate']) {
    const f = fixture({ view: 'timeline' });
    f[kind] = true;
    f.canReplaceDate = false;
    assert.equal(f.run(), false);
    assert.equal(f.ui.scheduleDate, oldDay);
    assert.equal(f.backdrop.hidden, false);
    assert.match(f.calls.find(call => call[0] === 'confirm-date')?.[1], /replace the date you haven’t applied/);
    f.canReplaceDate = true;
    assert.equal(f.run(), true);
    assert.equal(f.ui.scheduleDate, currentDay);
    assert.equal(f.ui.scheduleMine, true);
  }
  const alreadyOnDay = fixture({ view: 'timeline' });
  alreadyOnDay.ui.scheduleDate = currentDay;
  alreadyOnDay.dateDraft = true;
  alreadyOnDay.canReplaceDate = false;
  assert.equal(alreadyOnDay.run(), true);
  assert.ok(!alreadyOnDay.calls.some(call => call[0] === 'confirm-date'));
  const partialOnSameDay = fixture({ view: 'timeline' });
  partialOnSameDay.ui.scheduleDate = currentDay;
  partialOnSameDay.partialDate = true;
  partialOnSameDay.canReplaceDate = false;
  assert.equal(partialOnSameDay.run(), false);
  assert.equal(partialOnSameDay.backdrop.hidden, false);
  assert.ok(partialOnSameDay.calls.some(call => call[0] === 'confirm-date'));
});
