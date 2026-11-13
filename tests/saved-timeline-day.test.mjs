import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/schedule-ui.js';

const app = readFileSync('legacy/app.js', 'utf8');
const actor = 'jack', id = 'fictional-overnight', oldDay = '2099-10-10', savedDay = '2099-10-11', carryover = '2099-10-12';
const zone = 'America/Los_Angeles';
const slot = { start: `${savedDay}T23:45`, end: `${carryover}T02:00`, location: 'East <hall>' };
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const saved = { id, title: 'Overnight <handoff>', owner: actor, revision: 7, status: 'todo', eventActivity: true, schedule: slot };
const schedule = GatherScheduleUI.create({ h, options: () => '', statusBadge: h });

function fragment(from, to) {
  const start = app.indexOf(from), end = app.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, from);
  return app.slice(start, end);
}

function fixture({ date = oldDay, mine = true, task = saved, removed = false } = {}) {
  const state = { event: { name: 'Fictional event', timeZone: zone }, tasks: [{ ...task }], members: [{ id: actor, name: 'Fictional organizer' }], demoGeneration: 1 };
  const ui = { view: 'timeline', timelineMode: 'schedule', scheduleMine: mine, scheduleDate: date, actor };
  const window = { GatherAccessLost: false, GatherMode: { projectId: 'fictional-project' } };
  const backdrop = { hidden: true, classList: { remove() {} }, dataset: {} };
  const document = { hidden: false, body: { style: {} } }, calls = [], frames = [];
  const shell = {}, dialog = { replaceChildren() {} };
  let stale = false, knownNewer = false, organizer = true, revision = 19, pending;
  const row = (label, taskId, day) => ({ label, isConnected: true, dataset: { action: 'task', id: taskId, scheduleDay: day },
    matches: () => false, closest: () => null, getClientRects: () => [{}] });
  const exact = row('saved start day', id, savedDay);
  const rows = [row('same title', 'another-task', savedDay), row('carryover', id, carryover), exact];
  const heading = { id: 'schedulePanelHeading' };
  const receiptTitle = { id: 'scheduleFirstReceiptTitle', dataset: { id } };
  const opener = { id: 'scheduleSavedDay', isConnected: true, dataset: { action: 'show-saved-schedule-day', id, day: savedDay, scheduleDay: savedDay },
    matches: () => false, closest: () => null, getClientRects: () => [{}] };
  const root = { contains: element => [opener, heading, ...rows].includes(element), closest: () => null };
  let currentOpener = opener;
  const form = { id: 'scheduleForm', isConnected: true, dataset: { id } };
  const context = vm.createContext({ ui, window, document, schedule, GatherScheduleUI, h,
    store: { getState: () => state, getSnapshotRevision: () => revision,
      setTaskSchedule(taskId, value, acting) {
        calls.push(['write', taskId, value, acting]);
        return new Promise((resolve, reject) => { pending = { resolve(result, current = result) {
          if (current) state.tasks = [{ ...current }];
          revision++;
          resolve(result);
        }, reject }; });
      }, refresh() { assert.fail('This receipt action must not read the server.'); } },
    isOrganizer: () => organizer,
    isScheduleControl: control => control?.dataset.action === 'task',
    $: selector => ({ '#dialogBackdrop': backdrop, '#viewRoot': root, '#scheduleSavedDay': currentOpener, '#schedulePanelHeading': heading,
      '.schedule-panel': root, '#scheduleForm': form, '#scheduleFirstReceiptTitle': receiptTitle, '#appShell': shell, '#dialog': dialog })[selector] ?? null,
    $$: selector => selector.includes('schedule-row') ? rows : [], focusable: () => rows,
    workspaceUpdatesPending: () => stale, scheduleRevisionIsStale: () => knownNewer,
    focusScheduleTarget: target => { if (!target) return false; calls.push(['focus', target]); return true; },
    navigate(view, { scheduleDay }) {
      assert.equal(view, 'timeline');
      calls.push(['date', scheduleDay]);
      ui.scheduleDate = scheduleDay;
      calls.push(['render']);
      return true;
    },
    requestAnimationFrame: callback => frames.push(callback), render: () => calls.push(['render']), toast: message => calls.push(['toast', message]),
    taskDialog: (...args) => calls.push(['taskDialog', ...args]),
    restoreScheduleFocus: () => (calls.push(['return to source']), true), queueMicrotask() {},
    pageHeading: () => '', addButton: () => '', icon: () => '',
  });
  vm.runInContext(fragment('  function timelineScheduleScope(', '  function updatesView('), context);
  const submit = fragment("      if(form.id==='scheduleForm'||form.id==='schedulePickerForm')", "      if(form.id==='reviewScheduleForm')")
    .replace(/(?<!await )store\.setTaskSchedule\(/g, 'await store.setTaskSchedule(');
  vm.runInContext(fragment('  function eventScheduleSlotKey(', '  function eventScheduleEditorNotice(') +
    fragment('  function closeDialog(', '  function openOrganizerReview(') + `\nasync function saveSchedule(form,data,event) {${submit}}`, context);
  ui.firstScheduleReceipt = { id, key: context.scheduleWorkspaceKey(), zone, revision: task.revision, workspaceRevision: revision,
    reconfirm: true, ...(removed ? { removed: true } : {}) };
  return { ui, state, window, document, backdrop, opener, rows, exact, heading, calls, context, form, receiptTitle,
    set organizer(value) { organizer = value; }, set stale(value) { stale = value; }, set knownNewer(value) { knownNewer = value; },
    set revision(value) { revision = value; }, replaceOpener() { currentOpener = { ...opener }; },
    markup: () => context.firstScheduleReceiptMarkup(state), jump: (taskId = id, button = opener) => context.showSavedScheduleDay(taskId, button),
    openEdit() {
      delete ui.firstScheduleReceipt;
      ui.lastFocus = row('original row', id, oldDay);
      ui.dialogKind = 'task'; ui.detailId = id;
      backdrop.hidden = false;
    },
    submit: (data = slot, remove = false) => context.saveSchedule(form, data, { submitter: { value: remove ? 'remove' : 'save' } }),
    close: () => context.closeDialog(),
    get pending() { return pending; },
    flush() { for (const frame of frames.splice(0)) frame(); },
  };
}

const jumpMarkup = /<button[^>]*id="scheduleSavedDay"[^>]*data-action="show-saved-schedule-day"[^>]*>Show saved day<\/button>/;

test('a saved activity outside the selected date explains both filters, and only offers a day it can reveal', () => {
  const f = fixture(), html = f.markup();
  assert.match(html, /Schedule saved: Overnight &lt;handoff&gt;/);
  assert.match(html, /East &lt;hall&gt;/);
  assert.match(html, /selected date/);
  assert.match(html, /filters haven’t changed/);
  assert.match(html, /owner needs to accept again/);
  assert.match(html, jumpMarkup);
  assert.equal(f.ui.scheduleDate, oldDay);
  assert.equal(f.ui.scheduleMine, true);

  const other = fixture({ task: { ...saved, owner: 'fictional-teammate' } });
  assert.match(other.markup(), /selected date and My activities/);
  assert.doesNotMatch(other.markup(), jumpMarkup);
  other.ui.scheduleMine = false;
  assert.match(other.markup(), jumpMarkup);

  for (const date of [savedDay, carryover, '']) {
    const inside = fixture({ date });
    assert.match(inside.markup(), /Find this activity in the schedule below/);
    assert.doesNotMatch(inside.markup(), jumpMarkup, date);
  }
});

test('a confirmed removal keeps the task, reports that its slot is gone, and never offers a date', () => {
  const f = fixture({ task: { ...saved, schedule: null }, removed: true });
  assert.match(f.markup(), /removed from (?:the )?schedule/i);
  assert.match(f.markup(), /Overnight &lt;handoff&gt;/);
  assert.match(f.markup(), /task was kept|task is still|Open activity/i);
  assert.doesNotMatch(f.markup(), jumpMarkup);
  f.jump(); f.flush();
  assert.ok(!f.calls.some(([kind]) => ['date', 'focus'].includes(kind)));
  assert.equal(f.ui.scheduleDate, oldDay);
});

test('only the live receipt can change the selected date, and focus uses the exact row rather than a carryover', () => {
  const f = fixture(), baseline = structuredClone(f.state);
  f.jump(); f.flush();
  assert.deepEqual(f.calls, [['date', savedDay], ['render'], ['focus', f.exact]]);
  assert.equal(f.ui.scheduleDate, savedDay);
  assert.equal(f.ui.scheduleMine, true);
  assert.deepEqual(f.state, baseline);

  const missing = fixture();
  missing.rows.pop();
  missing.jump(); missing.flush();
  assert.deepEqual(missing.calls.filter(([kind]) => kind === 'focus'), [['focus', missing.heading]]);
});

test('a stale, re-scoped, replaced, hidden or invalid receipt cannot navigate', () => {
  const cases = {
    'replaced control': f => f.replaceOpener(), 'detached control': f => { f.opener.isConnected = false; },
    'disabled control': f => { f.opener.matches = () => true; }, 'hidden control': f => { f.opener.closest = () => ({}); },
    'already visible': f => { f.ui.scheduleDate = carryover; }, 'wrong project': f => { f.window.GatherMode.projectId = 'another-project'; },
    'wrong generation': f => { f.state.demoGeneration++; }, 'wrong actor': f => { f.ui.actor = 'different'; },
    'changed revision': f => { f.state.tasks[0].revision++; }, 'changed zone': f => { f.state.event.timeZone = 'UTC'; },
    'deleted task': f => { f.state.tasks = []; }, 'lost access': f => { f.window.GatherAccessLost = true; },
    'not organizer': f => { f.organizer = false; }, 'another view': f => { f.ui.view = 'tasks'; },
    'deadlines mode': f => { f.ui.timelineMode = 'deadlines'; }, 'open dialog': f => { f.backdrop.hidden = false; },
    'pending write': f => { f.ui.pendingSave = true; }, 'filtered owner': f => { f.state.tasks[0].owner = 'different'; },
    'newer data': f => { f.stale = true; }, 'known stale revision': f => { f.knownNewer = true; },
  };
  for (const [name, update] of Object.entries(cases)) {
    const f = fixture(); update(f);
    const prior = f.ui.scheduleDate;
    f.jump(); f.flush();
    assert.equal(f.ui.scheduleDate, prior, name);
    assert.ok(!f.calls.some(([kind]) => ['date', 'focus'].includes(kind)), name);
  }
  const f = fixture();
  f.jump('another-task');
  assert.deepEqual(f.calls, []);
});

const before = { ...saved, revision: 6, acceptedAt: '2099-10-09T20:00:00Z',
  schedule: { ...slot, start: `${oldDay}T17:30`, end: `${oldDay}T18:00` } };

test('an awaited direct activity edit records an exact moved or removed slot without touching Timeline filters', async () => {
  assert.match(readFileSync('scripts/prepare.mjs', 'utf8'), /'setTaskSchedule'/);
  for (const remove of [false, true]) {
    const f = fixture({ task: before });
    f.openEdit();
    const pending = f.submit(slot, remove);
    const [write, taskId, requested, acting] = f.calls[0];
    assert.deepEqual([write, taskId, requested && { ...requested }, acting], ['write', id, remove ? null : slot, actor]);
    assert.equal(f.calls.length, 1);
    assert.equal(f.ui.firstScheduleReceipt, undefined);
    f.pending.resolve({ ...saved, schedule: remove ? null : slot });
    await pending;
    assert.equal(f.ui.scheduleDate, oldDay);
    assert.equal(f.ui.scheduleMine, true);
    assert.equal(f.ui.firstScheduleReceipt?.revision, saved.revision);
    assert.equal(f.ui.firstScheduleReceipt.removed, remove);
    assert.equal(f.ui.firstScheduleReceipt.reconfirm, true);
    assert.ok(f.calls.some(([kind]) => kind === 'taskDialog'), 'keep the existing task editor return flow');
    assert.ok(!f.calls.some(([kind]) => kind === 'date' || kind === 'focus'));
  }
});

test('normal schedule save never mints a receipt for unconfirmed, unchanged or nested edits', async () => {
  for (const [name, update, response, current, mismatch] of [
    ['another returned task despite matching current state', () => {}, { ...saved, id: 'different' }, saved, true],
    ['old slot', () => {}, before, before, true],
    ['different returned slot', () => {}, { ...saved, schedule: before.schedule }, saved, true],
    ['different current slot', () => {}, saved, { ...saved, schedule: before.schedule }, true],
    ['same revision and same slot', f => { f.state.tasks = [{ ...saved }]; }, saved],
    ['old day still contains carryover', f => { f.ui.scheduleDate = carryover; }, saved],
    ['nested overlap', f => { f.ui.overlapComparison = {}; }, saved],
    ['event-review return', f => { f.ui.eventTaskReview = {}; }, saved],
    ['assignment return', f => { f.ui.acceptanceReturn = {}; }, saved],
    ['header picker', f => { f.form.id = 'schedulePickerForm'; }, saved],
  ]) {
    const f = fixture({ task: before });
    f.openEdit(); update(f);
    const result = f.submit();
    f.pending.resolve(response, current);
    if (mismatch) {
      await assert.rejects(result, /Couldn’t confirm this schedule change/, name);
      assert.deepEqual(f.calls.map(([kind]) => kind), ['write'], name);
    } else await result;
    assert.equal(f.ui.firstScheduleReceipt, undefined, name);
  }
  const f = fixture({ task: before });
  f.openEdit();
  const late = f.submit();
  f.form.isConnected = false;
  f.pending.resolve(saved);
  await late;
  assert.equal(f.ui.firstScheduleReceipt, undefined, 'late result after replacement');
  assert.deepEqual(f.calls.map(([kind]) => kind), ['write'], 'late result does not reopen a replaced editor');
});

test('closing the edited activity focuses its exact current receipt, but not a superseded one', async () => {
  for (const superseded of [false, true]) {
    const f = fixture({ task: before });
    f.openEdit();
    const result = f.submit();
    f.pending.resolve(saved);
    await result;
    assert.equal(f.ui.firstScheduleReceipt?.edited, true);
    if (superseded) f.state.tasks[0].revision++;
    f.calls.length = 0;
    f.close();
    assert.deepEqual(f.calls, superseded ? [['return to source']] : [['focus', f.receiptTitle]]);
    assert.equal(f.ui.scheduleDate, oldDay);
    assert.equal(f.ui.scheduleMine, true);
  }
});
