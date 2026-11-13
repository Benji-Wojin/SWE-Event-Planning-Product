import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/reschedule.js';
import '../legacy/store.js';
import '../legacy/schedule-ui.js';

const zone = 'America/Los_Angeles';
const first = { start: '2026-10-30T15:00', end: '2026-10-30T16:00', location: 'Old <hall>' };
const second = { ...first, start: '2026-10-30T15:30', location: 'Intermediate hall' };
const final = { start: '2026-10-31T17:00', end: '', location: 'New & <hall>' };
const actor = 'maya';
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const schedule = GatherScheduleUI.create({ h, options: () => '', statusBadge: value => h(value) });
const get = (store, id) => store.getState().tasks.find(task => task.id === id);
const reload = raw => GatherStore.createStore({ storage: { getItem: key => key === GatherStore.STORAGE_KEY ? raw : null, setItem() {} } });

function setup({ initial = first, verification = false } = {}) {
  const store = GatherStore.createStore({ storage: null });
  store.completeSetup({ date: '2026-10-30', timeZone: zone });
  const { id } = store.addTask({ title: 'Fictional activity', owner: actor, eventActivity: true, dueDate: '2026-10-23',
    requiresVerification: verification, ...(initial ? { schedule: initial } : {}) });
  return { store, id, get task() { return get(store, id); },
    accept() { return store.acceptTask(id, actor); },
    schedule(slot) { return store.setTaskSchedule(id, slot); },
    markup(viewer = actor) { return schedule.reconfirmation(get(store, id), store.getState().event, viewer); },
    move(toDate, moveSchedule = true) {
      const { event } = store.getState();
      return store.rescheduleEvent({ fromDate: event.date, toDate, timeZone: event.timeZone,
        tasks: [{ id, revision: get(store, id).revision, moveDue: !moveSchedule, moveSchedule }] });
    },
  };
}

test('repeated schedule changes retain the last accepted time and location until the owner reconfirms', () => {
  const f = setup();
  f.accept();
  const original = f.store.exportState();
  f.schedule({ ...first, location: '  ' + first.location + '  ' });
  assert.equal(f.store.exportState(), original, 'same normalized schedule keeps acceptance and history');
  f.schedule(second);
  assert.deepEqual(f.task.scheduleReconfirmation, { owner: actor, previous: first, timeZone: zone });
  assert.equal(f.task.acceptedAt, '');
  f.schedule(final);
  assert.deepEqual(f.task.scheduleReconfirmation, { owner: actor, previous: first, timeZone: zone });
  assert.deepEqual(f.task.schedule, final);
  assert.equal(f.task.status, 'todo');
  assert.equal(f.task.dueDate, '2026-10-23');
  const reloaded = reload(f.store.exportState());
  assert.deepEqual(get(reloaded, f.id).scheduleReconfirmation, f.task.scheduleReconfirmation);
  const markup = f.markup();
  assert.match(markup, /Before changes[\s\S]*Old &lt;hall&gt;[\s\S]*Current schedule[\s\S]*New &amp; &lt;hall&gt;/);
  assert.match(markup, /Oct 30, 2026/);
  assert.match(markup, /Oct 31, 2026/);
  assert.match(markup, /America\/Los_Angeles/);
  assert.doesNotMatch(markup, /Intermediate hall|<hall>|data-action=|<form/);
  assert.equal(f.markup('dev'), '');
  assert.equal(f.markup('jack'), '');
  f.store.acceptTasks([{ id: f.id, revision: f.task.revision }], actor);
  assert.ok(f.task.acceptedAt);
  assert.ok(!f.task.scheduleReconfirmation);
  assert.equal(f.markup(), '');
});

test('adding or removing a slot compares the prior no-schedule state honestly', () => {
  const f = setup({ initial: null });
  f.accept();
  f.schedule(first);
  assert.deepEqual(f.task.scheduleReconfirmation, { owner: actor, previous: null, timeZone: zone });
  assert.match(f.markup(), /Before changes[\s\S]*Not on the schedule[\s\S]*Current schedule[\s\S]*Old &lt;hall&gt;/);
  f.accept();
  f.schedule(null);
  assert.deepEqual(f.task.scheduleReconfirmation, { owner: actor, previous: first, timeZone: zone });
  assert.match(f.markup(), /Before changes[\s\S]*Old &lt;hall&gt;[\s\S]*Current schedule[\s\S]*Not on the schedule/);
});

test('moving a slot back to its earlier time is still an explicit reacceptance', () => {
  const f=setup();
  f.accept();
  f.schedule(second);
  f.schedule(first);
  assert.equal(f.task.acceptedAt,'');
  assert.match(f.markup(),/current schedule matches the earlier one, but you still need to accept again/);
});

test('a reviewed acceptance email does not acknowledge a changed schedule', () => {
  const f=setup();
  f.accept();
  const message=f.store.addMessage({sender:'Maya Singh',subject:'Fictional activity',taskId:f.id,body:'I accept this task.'});
  assert.equal(message.suggested.signal,'acceptance');
  f.schedule(second);
  f.store.refreshProposal(message.id,f.id);
  f.store.applyMessage(message.id,{mode:'update',taskId:f.id,status:f.task.status});
  assert.equal(f.task.acceptedAt,'');
  assert.deepEqual(f.task.scheduleReconfirmation,{owner:actor,previous:first,timeZone:zone});
  assert.equal(f.store.getState().messages.find(row=>row.id===message.id).appliedTaskId,f.id);
  f.accept();
  assert.equal(f.task.scheduleReconfirmation,undefined);
});

test('bulk date moves retain the baseline for activity moves but do not invent one for prep-only moves', () => {
  const f = setup();
  f.accept();
  f.move('2026-11-06');
  assert.deepEqual(f.task.scheduleReconfirmation, { owner: actor, previous: first, timeZone: zone });
  assert.deepEqual(f.task.schedule, { ...first, start: '2026-11-06T15:00', end: '2026-11-06T16:00' });
  f.move('2026-11-13');
  assert.deepEqual(f.task.scheduleReconfirmation, { owner: actor, previous: first, timeZone: zone });
  const prep = setup();
  prep.accept();
  prep.move('2026-11-06', false);
  assert.ok(!prep.task.scheduleReconfirmation);
  assert.deepEqual(prep.task.schedule, first);
});

test('reassignment, Next up acceptance, reporting, or completion clears pending schedule context', () => {
  for (const [label, resolve] of [
    ['owner', f => f.store.updateTask(f.id, { owner: 'dev' })],
    ['Next up', f => f.store.setNextUp(f.id, { enabled: true }, actor)],
    ['report', f => f.store.reportCompletion(f.id, 'Fictional result.', actor)],
    ['done', f => f.store.updateTask(f.id, { status: 'done' })],
  ]) {
    const f = setup({ verification: label === 'report' });
    f.accept();
    f.schedule(second);
    assert.ok(f.task.scheduleReconfirmation, label);
    resolve(f);
    assert.ok(!f.task.scheduleReconfirmation, label);
    assert.equal(f.markup(), '', label);
    assert.equal(f.markup('dev'), '', label);
  }
});

test('malformed optional prior schedule data does not hide the workspace or invent old facts', () => {
  const f = setup();
  f.accept();
  f.schedule(second);
  const persisted = JSON.parse(f.store.exportState());
  for (const bad of [
    { owner: 'dev', previous: first, timeZone: zone },
    { owner: actor, previous: { ...first, start: '2026-02-30T15:00' }, timeZone: zone },
    { owner: actor, previous: first, timeZone: 'Not/AZone' },
    { owner: actor, previous: first, timeZone: zone, note: 'Not a schedule field' },
  ]) {
    const input = structuredClone(persisted);
    input.tasks.find(task => task.id === f.id).scheduleReconfirmation = bad;
    const restored = get(reload(JSON.stringify(input)), f.id);
    assert.ok(restored);
    assert.deepEqual(restored.schedule, second);
    assert.ok(!restored.scheduleReconfirmation);
  }
});

test('assignment review exposes the comparison with its checkbox and does not preselect or change responsibility', () => {
  const f = setup();
  f.accept();
  f.schedule(final);
  const baseline = f.store.exportState();
  const source = readFileSync('legacy/app.js', 'utf8');
  const from = source.indexOf('  function acceptanceDialog('), to = source.indexOf('  function inspectAcceptanceTask(', from);
  assert.ok(from >= 0 && to > from);
  let html = '';
  const context = vm.createContext({ h, GatherScheduleUI, schedule, ui: { actor }, window: {}, store: f.store,
    filteredTasks: () => [f.task], acceptanceCandidates: tasks => tasks.filter(task => !task.acceptedAt && task.owner === actor),
    acceptanceReviewPending: () => false,
    assignmentReadiness: () => '', statuses: { todo: 'To do' }, dayLabel: h,
    openDialog: (_title, markup) => { html = markup; },
  });
  vm.runInContext(source.slice(from, to), context);
  context.acceptanceDialog();
  const checkbox = html.match(/<input[^>]+name="acceptTask"[^>]*>/)?.[0];
  assert.match(checkbox, new RegExp('aria-describedby="[^"]*accept-activity-' + f.id));
  assert.doesNotMatch(checkbox, /\bchecked\b/);
  assert.match(html, /Review schedule changes before accepting again[\s\S]*Old &lt;hall&gt;[\s\S]*New &amp; &lt;hall&gt;/);
  assert.equal((html.match(/Review schedule changes before accepting again/g) || []).length, 1);
  assert.match(html, /0 tasks selected/);
  assert.equal(f.store.exportState(), baseline);
});
