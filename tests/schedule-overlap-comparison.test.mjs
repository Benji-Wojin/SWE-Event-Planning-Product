import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/schedule-ui.js';

const day = '2026-10-04';
const zone = 'America/Los_Angeles';
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const schedule = GatherScheduleUI.create({ h, options: () => '', statusBadge: h });
const source = readFileSync('legacy/app.js', 'utf8');
const task = (id, start, end, location = 'Hall', owner = 'maya', patch = {}) => ({
  id, title: id, owner, status: 'todo', schedule: { start, end, location }, ...patch,
});
const state = (...tasks) => ({ event: { timeZone: zone }, members: [{ id: 'maya', name: 'Maya' }, { id: 'dev', name: 'Dev' }], tasks });
const original = () => task('Original activity', '2026-10-03T23:00', day + 'T01:00');
const peer = () => task('Peer activity', '2026-10-03T23:30', day + 'T00:00');
const later = () => task('Later activity', day + 'T00:30', day + 'T01:15');

test('competing activity controls retain exact owner or location intent and do not add edit controls for teammates', () => {
  const a = original(), b = peer(), c = later();
  const input = state(a, b, c), saved = structuredClone(input);
  for (const organizer of [false, true]) {
    const markup = schedule.details(a, organizer, input.event, input.tasks, day);
    const sections = [...markup.matchAll(/<details\b[^>]*data-schedule-overlap-kind="([^"]+)"[^>]*>([\s\S]*?)<\/details>/g)];
    assert.deepEqual(sections.map(([, kind]) => kind), ['owner', 'location']);
    for (const [, kind, section] of sections) {
      const peerButton = [...section.matchAll(/<button\b[^>]*>/g)].map(match => match[0]).find(tag => tag.includes(`data-id="${b.id}"`));
      assert.match(peerButton ?? '', /data-action="inspect-overlap-peer"/);
      assert.ok(peerButton.includes(`data-overlap-kind="${kind}"`));
      assert.match(section, /Overlap on another day/);
      if (!organizer) assert.doesNotMatch(section, /data-action="(?:review-overlap-schedule|review-task-owner)"|<form/);
    }
  }
  assert.deepEqual(input, saved);
});

test('a competing pair is rechecked across all saved dates and only for the requested conflict type', () => {
  const a = original(), b = peer();
  const input = state(a, b, later()), saved = structuredClone(input);
  const compare = (kind, current = input, origin = a.id, competing = b.id) => GatherScheduleUI.overlapPairIsCurrent(current, origin, competing, kind);
  assert.equal(compare('owner'), true);
  assert.equal(compare('location'), true, 'the competing interval ended at midnight before the originating date');
  assert.equal(compare('both'), false);
  assert.equal(compare('owner', input, a.id, a.id), false);
  assert.equal(compare('owner', input, a.id, 'missing'), false);
  assert.equal(compare('owner', state(a, { ...b, owner: 'dev' })), false);
  assert.equal(compare('location', state(a, { ...b, owner: 'dev' })), true);
  assert.equal(compare('location', state(a, { ...b, schedule: { ...b.schedule, location: 'Other room' } })), false);
  assert.equal(compare('owner', state(a, { ...b, status: 'done' })), false);
  assert.equal(compare('location', state(a, { ...b, schedule: { ...b.schedule, start: day + 'T01:00', end: day + 'T02:00' } })), false);
  const gap = task('Nonexistent time', '2030-03-10T02:15', '2030-03-10T03:30');
  const valid = task('Valid time', '2030-03-10T01:30', '2030-03-10T03:15');
  assert.equal(compare('owner', state(gap, valid), gap.id, valid.id), false);
  assert.deepEqual(input, saved);
});

function comparisonFixture() {
  const a = original(), b = peer(), c = later(), fourth = task('Fourth activity', '2026-10-03T23:40', day + 'T00:10');
  let snapshot = state(a, b, c, fourth);
  let pending = false;
  const ui = { actor: 'maya', view: 'timeline', timelineMode: 'schedule', dialogKind: 'task', detailId: a.id, overlapReviewDay: day };
  const window = { GatherMode: { projectId: 'fictional' } }, dialog = {}, backdrop = { hidden: false };
  const events = [], frames = [];
  let heading = { name: 'dialog heading' };
  function section(kind, opened, ids) {
    const disclosure = { dataset: { scheduleOverlapKind: kind }, open: opened, isConnected: true,
      summary: { name: `${kind} summary` }, contains: el => buttons.includes(el) || el === disclosure.summary };
    const buttons = ids.map(id => ({ name: `${kind} link ${id}`, isConnected: true,
      dataset: { action: 'inspect-overlap-peer', id, overlapKind: kind }, closest: selector => selector === '#dialog' ? dialog : disclosure }));
    disclosure.buttons = buttons;
    disclosure.closest = () => disclosure;
    return disclosure;
  }
  let sections = [section('owner', true, [b.id, c.id, fourth.id]), section('location', true, [b.id, c.id, fourth.id])];
  dialog.contains = element => sections.some(s => s.contains(element) || s === element);
  const getMany = (selector, root) => {
    const candidates = selector.includes('data-schedule-overlap-kind') ? sections : root?.buttons || sections.flatMap(s => s.buttons);
    const kind = selector.match(/data-(?:schedule-)?overlap-kind="(owner|location)"/)?.[1];
    return kind ? candidates.filter(el => (el.dataset.scheduleOverlapKind || el.dataset.overlapKind) === kind) : candidates;
  };
  const context = vm.createContext({
    ui, window, GatherScheduleUI, store: { getState: () => snapshot }, requestAnimationFrame: cb => frames.push(cb),
    $$(selector, root) { return getMany(selector, root); },
    $(selector, root) {
      if (selector === '#dialog') return dialog;
      if (selector === '#dialogBackdrop') return backdrop;
      if (selector === '#dialogTitle') return heading;
      if (selector === 'summary') return root?.summary;
      return getMany(selector, root)[0] ?? null;
    },
    taskDialog(...args) {
      const [id] = args;
      events.push(['open', ...args]);
      ui.dialogKind = 'task'; ui.detailId = id; ui.overlapReviewDay = args[6] || '';
      if (ui.relatedBatch && id !== ui.relatedBatch.parentId && id !== ui.relatedBatch.childId) ui.relatedBatch = null;
      heading = { name: 'dialog heading' };
      sections = id === a.id ? [section('owner', false, [b.id, c.id, fourth.id]), section('location', false, [b.id, c.id, fourth.id])]
        : [section('owner', true, [a.id, fourth.id]), section('location', true, [a.id, fourth.id])];
    },
    closeDialog() { events.push(['close']); ui.dialogKind = ''; backdrop.hidden = true; },
    toast(message) { events.push(['toast', message]); },
    focusTaskDialogControl(element, root) { assert.equal(root, dialog); events.push(['focus', element?.name]); },
    workspaceUpdatesPending: () => pending, showPendingUpdate: () => events.push(['stale', ui.detailId]),
    relatedBatchInScope: batch => batch.actor === ui.actor && batch.project === window.GatherMode.projectId && batch.view === ui.view,
  });
  const start = source.indexOf('  function overlapComparisonInScope(');
  const end = source.indexOf('  function openReturnedCompletion(', start);
  assert.ok(start >= 0 && end > start, 'comparison helpers are present');
  vm.runInContext(source.slice(start, end), context);
  const inspect = (kind, id = b.id) => context.inspectOverlapPeer(id, sections.find(s => s.dataset.scheduleOverlapKind === kind)?.buttons.find(el => el.dataset.id === id));
  return { a, b, c, fourth, ui, window, events, context, backdrop, inspect,
    get sections() { return sections; }, set snapshot(value) { snapshot = value; },
    set pending(value) { pending = value; },
    replaceHeading: () => { heading = { name: 'replacement heading' }; },
    flush: () => { for (const fn of frames.splice(0)) fn(); },
  };
}

test('comparison returns to the exact peer link in its original disclosure and restores the first day', () => {
  const f = comparisonFixture();
  f.inspect('location');
  assert.equal(f.ui.detailId, f.b.id);
  const initial = f.ui.overlapComparison;
  assert.equal(initial.originId, f.a.id);
  assert.equal(initial.returnPeerId, f.b.id);
  assert.equal(initial.kind, 'location');
  assert.equal(initial.reviewDay, day);
  f.inspect('owner', f.fourth.id);
  assert.equal(f.ui.detailId, f.fourth.id);
  assert.equal(f.ui.overlapComparison.originId, f.a.id, 'inspecting another peer cannot replace the return anchor');
  assert.equal(f.ui.overlapComparison.returnPeerId, f.b.id);
  f.context.returnToOverlapReview();
  assert.equal(f.ui.detailId, f.a.id);
  assert.equal(f.ui.overlapReviewDay, day);
  assert.deepEqual(f.events.filter(([type]) => type === 'focus'), []);
  f.flush();
  assert.ok(f.sections.every(section => section.open), 'restores both originally expanded sections');
  assert.deepEqual(f.events.filter(([type]) => type === 'focus'), [['focus', `location link ${f.b.id}`]]);
});

test('a stale pair cannot open, and another project or actor cannot restore an existing comparison', () => {
  const stale = comparisonFixture();
  stale.snapshot = state(stale.a, { ...stale.b, schedule: { ...stale.b.schedule, location: 'Another room' } }, stale.c);
  stale.inspect('location');
  assert.equal(stale.ui.detailId, stale.a.id);
  assert.ok(stale.events.every(([type]) => type !== 'open'));
  const closed = comparisonFixture();
  closed.sections.find(section => section.dataset.scheduleOverlapKind === 'location').open = false;
  assert.equal(closed.inspect('location'), false);
  assert.equal(closed.ui.detailId, closed.a.id);
  assert.ok(closed.events.every(([type]) => type !== 'open'));
  for (const change of [f => { f.ui.actor = 'dev'; }, f => { f.ui.view = 'tasks'; }, f => { f.window.GatherAccessLost = true; },
    f => { f.window.GatherMode.projectId = 'other'; }]) {
    const f = comparisonFixture();
    f.inspect('owner');
    f.events.length = 0;
    change(f);
    f.context.returnToOverlapReview();
    f.flush();
    assert.ok(f.events.every(([type]) => type !== 'open' && type !== 'focus'));
  }
});

test('return after a change uses the original disclosure summary or heading and cannot focus a replacement', () => {
  for (const [visibility, expected] of [['no peer', 'location summary'], ['no disclosure', 'dialog heading'], ['replaced', undefined]]) {
    const f = comparisonFixture();
    f.inspect('location');
    f.events.length = 0;
    f.context.returnToOverlapReview();
    const location = f.sections.find(section => section.dataset.scheduleOverlapKind === 'location');
    if (visibility === 'no peer') location.buttons.splice(location.buttons.findIndex(el => el.dataset.id === f.b.id), 1);
    if (visibility === 'no disclosure') f.sections.splice(f.sections.indexOf(location), 1);
    if (visibility === 'replaced') f.replaceHeading();
    f.flush();
    assert.deepEqual(f.events.filter(([type]) => type === 'focus'), expected ? [['focus', expected]] : []);
  }
  const deleted = comparisonFixture();
  deleted.inspect('owner');
  deleted.events.length = 0;
  deleted.snapshot = state(deleted.b, deleted.c);
  deleted.context.returnToOverlapReview();
  deleted.flush();
  assert.ok(deleted.events.some(([type]) => type === 'close'));
  assert.ok(deleted.events.every(([type]) => type !== 'open' && type !== 'focus'));
});

test('the original activity can be revisited from the peer without creating a circular comparison', () => {
  const f = comparisonFixture();
  assert.equal(f.inspect('location'), true);
  assert.equal(f.inspect('owner', f.a.id), true);
  assert.equal(f.ui.detailId, f.a.id);
  assert.equal(f.ui.overlapComparison, null);
  f.flush();
  assert.deepEqual(f.events.filter(([type]) => type === 'focus'), [['focus', `location link ${f.b.id}`]]);
});

test('a conflict that ends during comparison returns to its summary even if an old opener can still be found', () => {
  const f = comparisonFixture();
  f.inspect('location');
  f.snapshot = state(f.a, { ...f.b, schedule: { ...f.b.schedule, location: 'Another room' } }, f.c);
  f.context.returnToOverlapReview();
  f.flush();
  assert.deepEqual(f.events.filter(([type]) => type === 'focus'), [['focus', 'location summary']]);
  assert.ok(f.events.some(([type, copy]) => type === 'toast' && /overlap is no longer current/i.test(copy)));
});

test('known newer workspace data blocks comparison and keeps a warning when returning to the cached review', () => {
  const blocked = comparisonFixture();
  blocked.pending = true;
  assert.equal(blocked.inspect('owner'), false);
  assert.equal(blocked.ui.detailId, blocked.a.id);
  assert.ok(!blocked.ui.overlapComparison);
  assert.deepEqual(blocked.events, [['stale', blocked.a.id], ['toast', 'Refresh the project before comparing this overlap.']]);

  const returning = comparisonFixture();
  assert.equal(returning.inspect('location'), true);
  returning.events.length = 0;
  returning.pending = true;
  assert.equal(returning.context.returnToOverlapReview(), true);
  assert.equal(returning.ui.detailId, returning.a.id);
  assert.equal(returning.ui.overlapReviewDay, day);
  assert.deepEqual(returning.events.map(([type]) => type), ['open', 'stale', 'toast'], 'the pending warning belongs to the rebuilt origin');
  assert.deepEqual(returning.events[1], ['stale', returning.a.id]);
  assert.match(returning.events[2][1], /Refresh the project to check/);
  returning.flush();
  assert.deepEqual(returning.events.filter(([type]) => type === 'focus'), [['focus', 'location summary']], 'cached pair links are not treated as current');
});

test('return restores the original breakdown batch only if that batch still belongs to the current scope', () => {
  for (const staleKey of ['', 'project', 'actor', 'view']) {
    const f = comparisonFixture();
    const batch = { actor: 'maya', project: 'fictional', view: 'timeline', parentId: 'Original parent', childId: f.a.id, ids: [f.a.id] };
    f.ui.relatedBatch = batch;
    assert.equal(f.inspect('owner'), true);
    assert.equal(f.ui.relatedBatch, null, 'the peer is not one of the saved batch tasks');
    const savedBatch = f.ui.overlapComparison.relatedBatch;
    assert.notEqual(savedBatch, batch, 'comparison captures an independent copy of the return context');
    assert.deepEqual(JSON.parse(JSON.stringify(savedBatch)), batch);
    batch.ids.push('Another task');
    assert.deepEqual(Array.from(savedBatch.ids), [f.a.id], 'later edits to the original batch cannot change the captured IDs');
    if (staleKey) savedBatch[staleKey] = 'different scope';
    assert.equal(f.context.returnToOverlapReview(), true);
    assert.equal(f.ui.detailId, f.a.id);
    assert.equal(f.ui.relatedBatch, staleKey ? null : savedBatch);
    f.flush();
  }
});
