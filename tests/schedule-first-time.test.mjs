import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/schedule-ui.js';

const source = readFileSync('legacy/app.js', 'utf8');
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const options = (entries, selected) => entries.map(([id, label]) =>
  '<option value="' + h(id) + '"' + (id === selected ? ' selected' : '') + '>' + h(label) + '</option>').join('');
const schedule = GatherScheduleUI.create({ h, options, statusBadge: value => h(value) });
const date = '2026-11-20', actor = 'jack';
const slot = { start: '2026-11-21T18:30', end: '2026-11-21T19:00', location: 'East <hall>' };
const task = (id, patch = {}) => ({ id, title: id, owner: actor, status: 'todo', revision: 3, eventActivity: true, ...patch });
const fixed = task('fixed', { title: 'Schedule <briefing>', acceptedAt: '2026-11-01T20:00:00Z' });
const other = task('different', { owner: 'maya', title: 'Other person’s activity' });
const state = tasks => ({ event: { name: 'Fictional event', timeZone: 'America/Los_Angeles' },
  members: [{ id: actor, name: 'Organizer' }, { id: 'maya', name: 'Teammate' }], tasks });

function fragment(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}

test('only eligible organizer rows get Set start time; it keeps pending items outside the date filter', () => {
  const s = state([fixed, other, task('scheduled', { schedule: slot }), task('done', { status: 'done' }),
    task('prep', { eventActivity: false, dueDate: date })]);
  const scope = { mine: true, actor, date };
  const html = schedule.view(s, true, Date.parse(date + 'T12:00:00Z'), scope);
  const starts = [...html.matchAll(/data-action="schedule-set-start"[^>]*data-id="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(starts, ['fixed']);
  assert.match(html, /Set start time for Schedule &lt;briefing&gt;/);
  assert.match(html, /Undated activities are shown here regardless of the selected date/);
  assert.doesNotMatch(schedule.view(s, false, Date.parse(date + 'T12:00:00Z'), scope), /data-action="schedule-set-start"/);
  const all = schedule.view(s, true, Date.parse(date + 'T12:00:00Z'), { ...scope, mine: false });
  assert.match(all, /data-action="schedule-set-start"[^>]*data-id="different"/);
});

test('the first-time form binds one current activity and does not preselect another task or infer times', () => {
  const s = state([fixed, other]);
  const scope = { mine: true, actor, date };
  const html = schedule.firstTimeForm(s, fixed.id, scope);
  assert.match(html, /Schedule &lt;briefing&gt;/);
  assert.match(html, /id="firstScheduleForm"[^>]*data-id="fixed"[^>]*data-revision="3"/);
  assert.match(html, /America\/Los_Angeles/);
  const start = html.match(/<input\b[^>]*name="start"[^>]*>/)?.[0];
  assert.match(start, /required/);
  assert.doesNotMatch(start, /value="[^"]+"/);
  assert.doesNotMatch(html, /name="taskId"|Other person’s activity|name="dueDate"|Remove from schedule/);
  assert.match(schedule.picker(s), /id="schedulePickerForm"[\s\S]*name="taskId"/);
  assert.equal(schedule.firstTimeTask(s, fixed.id, scope), fixed);
  assert.ok(!schedule.firstTimeTask(s, other.id, scope));
  for (const invalid of [
    state([other]),
    state([{ ...fixed, status: 'done' }]),
    state([{ ...fixed, schedule: slot }]),
    state([{ ...fixed, eventActivity: false }]),
  ]) assert.equal(schedule.firstTimeForm(invalid, fixed.id, scope), '');
  assert.doesNotMatch(schedule.firstTimeForm({ ...s, event: { timeZone: '' } }, fixed.id, scope), /firstScheduleForm/);
});

function fixture({ mine = true, currentDate = date, initial = [fixed, other] } = {}) {
  const ui = { actor, view: 'timeline', timelineMode: 'schedule', scheduleMine: mine, scheduleDate: currentDate, dialogKind: '', lastFocus: null };
  const window = { GatherAccessLost: false, GatherMode: { projectId: 'fictional-event' } };
  const backdrop = { hidden: true }, dialog = {}, heading = {};
  const calls = [], frames = [];
  let organizer = true, snapshot = state(initial), pending, form = null;
  const receipt = { focus() { calls.push(['focus', 'receipt']); }, scrollIntoView() {} };
  const receiptOpen = { isConnected: true, dataset: { id: fixed.id } };
  const opener = { dataset: { action: 'schedule-set-start', id: fixed.id }, isConnected: true,
    closest(selector) { return selector.includes('hidden') || selector.includes('inert') ? null : root; }, focus() {}, };
  const root = { contains: candidate => candidate === opener, closest: () => null, querySelector: () => opener };
  const document = { hidden: false, activeElement: opener };
  const selectors = { '#dialogBackdrop': backdrop, '#dialog': dialog, '#dialogTitle': heading, '#viewRoot': root,
    '#scheduleFirstReceipt': receipt, '#scheduleFirstReceiptTitle': receipt, '#scheduleFirstReceiptOpen': receiptOpen,
    '.schedule-pending': root, '.schedule-panel': root };
  const context = vm.createContext({ ui, window, document, schedule, GatherScheduleUI, h,
    $: selector => selector === '#firstScheduleForm' ? form : selectors[selector] ?? null, $$: () => [opener],
    focusScheduleTarget: node => { node?.focus(); return !!node; }, focusTaskDialogControl: () => {},
    requestAnimationFrame: callback => frames.push(callback), isOrganizer: () => organizer,
    pageHeading: (_crumb, title, _sub, actions) => '<h1>' + title + '</h1>' + actions, addButton: () => '', icon: () => '',
    workspaceUpdatesPending: () => false, scheduleRevisionIsStale: () => false,
    store: { getState: () => snapshot, setTaskSchedule(id, data, actor) {
      calls.push(['write', id, data, actor]);
      return new Promise((resolve, reject) => {
        pending = { resolve: saved => { snapshot.tasks = snapshot.tasks.map(item => item.id === id ? saved : item); resolve(saved); }, reject };
      });
    } },
    openDialog(title, body, footer, wide, kind) {
      calls.push(['open', title, body, footer, wide, kind]);
      backdrop.hidden = false;
      ui.dialogKind = kind;
      if (body.includes('id="firstScheduleForm"')) {
        form = { id: 'firstScheduleForm', isConnected: true,
          dataset: { id: body.match(/id="firstScheduleForm"[^>]*data-id="([^"]+)"/)[1], revision: body.match(/id="firstScheduleForm"[^>]*data-revision="([^"]+)"/)[1] },
        };
      }
    },
    closeDialog(target) {
      calls.push(['close']);
      if (form) form.isConnected = false;
      backdrop.hidden = true;
      ui.dialogKind = '';
      form = null;
      target?.focus();
    },
    render() { calls.push(['render']); }, toast: message => calls.push(['toast', message]),
    taskDialog: (...args) => calls.push(['task', ...args]),
  });
  vm.runInContext(fragment('  function timelineScheduleScope(', '  function updatesView(')
    .replace(/(?<!await )store\.setTaskSchedule\(/g, 'await store.setTaskSchedule('), context);
  return { ui, window, opener, calls, context, receiptOpen,
    get form() { return form; }, get pending() { return pending; },
    set organizer(value) { organizer = value; },
    set tasks(value) { snapshot = state(value); },
    set zone(value) { snapshot.event.timeZone = value; },
    open: (id = fixed.id, control = opener) => context.openFirstSchedule(id, control),
    save: (values = slot, currentForm = form) => context.saveFirstSchedule(currentForm, values),
    timeline: () => context.timelineView(snapshot),
    flush: () => { for (const callback of frames.splice(0)) callback(); },
  };
}

test('the exact Timeline opener rejects detached, out-of-scope and non-organizer routes', () => {
  for (const deny of [
    f => { f.organizer = false; }, f => { f.window.GatherAccessLost = true; }, f => { f.ui.view = 'tasks'; },
    f => { f.ui.timelineMode = 'deadlines'; }, f => { f.opener.isConnected = false; }, f => { f.opener.dataset.id = other.id; },
  ]) {
    const f = fixture();
    deny(f);
    f.open();
    assert.equal(f.form, null);
    assert.deepEqual(f.calls, []);
  }
  const f = fixture();
  f.tasks = [other, { ...fixed, schedule: slot }];
  f.open();
  assert.equal(f.form, null);
  assert.match(f.calls[0]?.[1], /no longer waiting/);
  f.tasks = [other, fixed];
  f.open();
  assert.equal(f.ui.dialogKind, 'first-schedule');
  assert.equal(f.ui.lastFocus, f.opener);
  assert.equal(f.form.dataset.id, fixed.id);
});

test('the hosted first-time save waits, writes only the fixed activity, then focuses a scoped receipt', async () => {
  assert.match(readFileSync('scripts/prepare.mjs', 'utf8'), /'setTaskSchedule'/);
  const f = fixture();
  f.open();
  f.calls.length = 0;
  const result = f.save({ ...slot, taskId: other.id, dueDate: '2026-11-22' });
  assert.equal(f.calls.length, 1);
  assert.deepEqual([f.calls[0][0], f.calls[0][1], { ...f.calls[0][2] }, f.calls[0][3]], ['write', fixed.id, slot, actor]);
  assert.equal(f.ui.dialogKind, 'first-schedule');
  assert.doesNotMatch(f.timeline(), /scheduleFirstReceipt/);
  f.pending.resolve({ ...fixed, schedule: slot, acceptedAt: '', nextUpAt: '', revision: 4 });
  await result;
  f.flush();
  assert.deepEqual(f.calls.slice(1), [['render'], ['close'], ['focus', 'receipt']]);
  const html = f.timeline(), receipt = html.match(/<section id="scheduleFirstReceipt"[\s\S]*?<\/section>/)?.[0];
  assert.match(receipt, /Schedule saved: Schedule &lt;briefing&gt;/);
  assert.match(receipt, /Nov 21, 2026/);
  assert.match(receipt, /America\/Los_Angeles/);
  assert.match(receipt, /East &lt;hall&gt;/);
  assert.match(receipt, /Not shown below because of the selected date/);
  assert.match(receipt, /filters haven’t changed/);
  assert.match(receipt, /owner needs to accept again/);
  assert.match(receipt, /data-action="open-first-schedule-receipt" data-id="fixed">Open activity/);
  assert.doesNotMatch(receipt, /Other person|data-id="different"/);
  assert.match(html, /data-action="schedule-task">Schedule existing task/);
  assert.equal(f.ui.scheduleMine, true);
  assert.equal(f.ui.scheduleDate, date);
  f.calls.length = 0;
  f.context.openFirstScheduleReceipt(fixed.id, { ...f.receiptOpen });
  f.context.openFirstScheduleReceipt(other.id, f.receiptOpen);
  assert.deepEqual(f.calls, []);
  f.context.openFirstScheduleReceipt(fixed.id, f.receiptOpen);
  assert.deepEqual(f.calls[0].slice(0,-1), ['task', fixed.id, '', false, true, '', undefined, '']);
  assert.equal(f.calls[0].at(-1).readOnly, true);
});

test('stale, changed-scope and failed saves preserve draft, and a late response cannot replace the current view', async () => {
  for (const [name, invalidate, message] of [
    ['revision', f => { f.tasks = [{ ...fixed, revision: 4 }, other]; }, /activity changed/],
    ['already scheduled', f => { f.tasks = [{ ...fixed, schedule: slot }, other]; }, /activity changed/],
    ['reassigned', f => { f.tasks = [{ ...fixed, owner: other.owner }, other]; }, /activity changed/],
    ['different date', f => { f.ui.scheduleDate = '2026-11-22'; }, /current Timeline/],
    ['different time zone', f => { f.zone = 'America/New_York'; }, /activity changed/],
    ['role', f => { f.organizer = false; }, /current Timeline/],
    ['access', f => { f.window.GatherAccessLost = true; }, /current Timeline/],
  ]) {
    const f = fixture();
    f.open();
    f.calls.length = 0;
    invalidate(f);
    const attempt = f.save();
    f.pending?.reject(new Error('The guard unexpectedly dispatched a save: ' + name));
    await assert.rejects(attempt, message, name);
    assert.deepEqual(f.calls, []);
    assert.equal(f.form.isConnected, true);
  }
  const f = fixture();
  f.open();
  f.calls.length = 0;
  const failed = f.save();
  f.pending.reject(new Error('Fictional save rejected'));
  await assert.rejects(failed, /Fictional save rejected/);
  assert.equal(f.form.isConnected, true);
  assert.equal(f.calls.length, 1);
  const late = f.save();
  f.window.GatherMode.projectId = 'other-fictional-project';
  f.pending.resolve({ ...fixed, schedule: slot, revision: 4 });
  await late;
  assert.equal(f.calls.length, 2, 'no receipt, focus or closing after the project changes');
  assert.equal(f.ui.firstScheduleReceipt, undefined);
});

test('the receipt explains both active filters and disappears if its exact saved revision changes', async () => {
  const f = fixture({ mine: false, initial: [{ ...fixed, owner: other.owner }, other] });
  f.open();
  const result = f.save();
  const saved = { ...fixed, owner: other.owner, schedule: slot, revision: 4 };
  f.pending.resolve(saved);
  await result;
  f.ui.scheduleMine = true;
  assert.match(f.timeline(), /Not shown below because of the selected date and My activities/);
  f.zone = 'America/New_York';
  assert.doesNotMatch(f.timeline(), /id="scheduleFirstReceipt"/);
  f.calls.length = 0;
  f.context.openFirstScheduleReceipt(fixed.id, f.receiptOpen);
  assert.deepEqual(f.calls, []);
  f.tasks = [{ ...saved, revision: 5 }, other];
  assert.doesNotMatch(f.timeline(), /id="scheduleFirstReceipt"/);
});
