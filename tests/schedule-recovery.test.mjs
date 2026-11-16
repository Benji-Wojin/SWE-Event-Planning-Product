import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/priorities.js';
import '../legacy/schedule-ui.js';

const now = '2026-11-20T17:15:00Z';
const today = '2026-11-20';
const tomorrow = '2026-11-21';
const proposed = '2033-01-17';
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const ui = GatherScheduleUI.create({ h, options: () => '', statusBadge: status => `<span>${h(status)}</span>` });
const help = 'Help requested · awaiting organizer';
const date = 'Date proposed · awaiting organizer';
const privateText = /FICTIONAL-REQUEST-NOTE|FICTIONAL-REPLY-NOTE|2033-01-17|Jan 17, 2033/;
const requestCue = /Help requested · awaiting organizer|Date proposed · awaiting organizer/;
const savedStatus = /<span>todo<\/span>/;
const schedule = day => ({ start: day + 'T09:00', end: day + 'T09:30', location: 'Fictional hall' });
const button = (markup, id, className) => [...markup.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
  .map(match => match[0]).find(value => value.split('>')[0].includes(`data-id="${id}"`) && (!className || value.split('>')[0].includes(className))) || '';
const requestGroup = state => GatherScheduleUI.reviewItems(state, now, { mine: true, actor: 'maya', date: today })
  .find(group => group.key === 'plan-requests');
const requestGroupMarkup = markup => markup.match(/<details[^>]*data-event-review-group="plan-requests"[^>]*>[\s\S]*?<\/details>/)?.[0] || '';

function fixture() {
  const store = GatherStore.createStore({ storage: null, now: Date.parse(now) });
  store.completeSetup({ timeZone: 'America/Los_Angeles' });
  const add = (title, owner = 'maya', day = today, extra = {}) => store.addTask({ title, owner, schedule: schedule(day), ...extra });
  const ask = (task, kind, actor = 'maya') => store.requestRecovery(task.id, {
    kind, note: 'FICTIONAL-REQUEST-NOTE', ...(kind === 'date' ? { proposedDate: proposed } : {}),
  }, actor);
  const request = task => GatherPriorities.pendingRequest(store.getState().tasks.find(item => item.id === task.id));
  const resolve = task => store.resolveRecovery(task.id, {
    requestId: request(task).id, action: 'checkin', note: 'FICTIONAL-REPLY-NOTE', reviewAfter: tomorrow,
  }, 'jack');
  return { store, add, ask, request, resolve };
}

test('Timeline and the team Run sheet show current request status without changing the plan or exporting request details', () => {
  const { store, add, ask, resolve } = fixture();
  const mine = add('My fictional check-in');
  const other = add('Other fictional activity', 'jules');
  const future = add('Future fictional activity', 'maya', tomorrow);
  ask(mine, 'help');
  ask(other, 'help', 'jules');
  ask(future, 'date');

  const scope = { mine: true, actor: 'maya', date: today };
  function assertOwnLive(label, absent) {
    const before = store.exportState(), state = store.getState();
    const [clock, view] = [ui.clock(state, now, scope, true).markup, ui.view(state, true, now, scope)];
    const ownClock = button(clock, mine.id, 'schedule-focus-task');
    const ownRow = button(view, mine.id, 'schedule-row');
    for (const row of [ownClock, ownRow]) {
      assert.match(row, /data-action="task"/);
      assert.equal(/\bdata-open-recovery\b/.test(row), !!label);
      if (label) assert.ok(row.includes(label), `${label} appears on the task route`);
      if (absent) assert.ok(!row.includes(absent));
      assert.match(row, savedStatus);
    }
    for (const output of [clock, view]) {
      assert.doesNotMatch(output, privateText);
      assert.doesNotMatch(output, /Other fictional activity|Future fictional activity|data-action="review-organizer-item"/);
    }
    assert.equal(store.exportState(), before);
    assert.deepEqual(state.tasks.find(task => task.id === mine.id).schedule, mine.schedule);
  }
  assertOwnLive(help, date);
  ask(mine, 'date');
  assertOwnLive(date, help);
  const state = store.getState();
  const futureScope = { ...scope, date: tomorrow };
  assert.equal(ui.clock(state, now, futureScope, false).markup, '');
  const futureView = ui.view(state, false, now, futureScope);
  const futureRow = button(futureView, future.id, 'schedule-row');
  assert.match(futureRow, /data-action="task"/);
  assert.match(futureRow, /\bdata-open-recovery\b/);
  assert.ok(futureRow.includes(date));
  assert.doesNotMatch(futureView, /My fictional check-in|Other fictional activity/);
  const unfilteredClock = ui.clock(state, now, { date: today }, false).markup;
  assert.ok(button(unfilteredClock, other.id, 'schedule-focus-task').includes(help));

  for (const output of [ui.runSheet(state, now, scope), ui.runSheetText(ui.runSheetModel(state, now, scope))]) {
    assert.ok(output.includes(date));
    assert.ok(!output.includes(help));
    assert.doesNotMatch(output, privateText);
  }
  const guest = GatherScheduleUI.guestAgendaSnapshot(state, scope);
  assert.deepEqual(guest.activities, [{ title: mine.title, start: mine.schedule.start, end: mine.schedule.end }]);
  assert.doesNotMatch(JSON.stringify(guest), /recoveryRequests|FICTIONAL-REQUEST-NOTE|2033-01-17/);
  const guestText = GatherScheduleUI.guestAgenda(guest, 'Fictional agenda', [{ included: true, title: mine.title }]);
  assert.ok(guestText.includes(mine.title));
  assert.doesNotMatch(guestText, requestCue);
  assert.doesNotMatch(guestText, privateText);

  resolve(mine);
  assertOwnLive('', date);
  assert.doesNotMatch(ui.runSheet(store.getState(), now, scope), requestCue);
});

test('Before event scopes pending requests and opens the existing role-appropriate task review', () => {
  const { store, add, ask, resolve } = fixture();
  const mineHelp = add('Help task');
  const mineDate = add('Date task on a different day', 'maya', tomorrow);
  const other = add('Another owner', 'jules');
  const answered = add('Resolved task');
  const superseded = add('Superseded task');
  const reported = add('Awaiting verification task', 'maya', today, { requiresVerification: true });
  for (const task of [mineHelp, answered, superseded, reported]) ask(task, 'help');
  ask(mineDate, 'date');
  ask(other, 'help', 'jules');
  resolve(answered);
  store.updateTask(superseded.id, { dueDate: tomorrow }, 'jack');
  store.reportCompletion(reported.id, 'Fictional result', 'maya');

  const scope = { mine: true, actor: 'maya', date: today }, state = store.getState();
  // Simulate an old record retaining a pending flag alongside verification or completion.
  state.tasks.find(task => task.id === reported.id).recoveryRequests[0].status = 'pending';
  const done = { ...state.tasks.find(task => task.id === reported.id), id: 'legacy-done', title: 'Historical completed task', status: 'done' };
  state.tasks.push(done);
  const before = structuredClone(state);
  assert.deepEqual(new Set(requestGroup(state)?.tasks.map(task => task.id)), new Set([mineHelp.id, mineDate.id]),
    'Before event reviews all dates within the selected owner scope, excluding stale and completed work');
  for (const organizer of [true, false]) {
    const markup = ui.preparationReview(state, now, scope, organizer);
    const group = requestGroupMarkup(markup);
    assert.match(group, /Plan requests awaiting review · 2/);
    for (const [task, kind, label] of [[mineHelp, 'help', help], [mineDate, 'date', date]]) {
      const opener = button(group, task.id);
      assert.match(opener, organizer ? /data-action="review-organizer-item"/ : /data-action="task"/);
      if (organizer) assert.ok(opener.includes(`data-review-kind="${kind}"`));
      else assert.match(opener, /\bdata-open-recovery\b/);
      assert.ok(group.includes(label));
    }
    for (const task of [answered, superseded, reported, done, other]) assert.equal(button(group, task.id), '');
    assert.doesNotMatch(markup, privateText);
    assert.doesNotMatch(group, /<form|data-action="(?:verify-task|resolve-recovery|request-recovery|toggle-task)"/);
  }
  assert.match(button(requestGroupMarkup(ui.preparationReview(state, now, {}, true)), other.id), /data-review-kind="help"/);
  assert.deepEqual(state, before);
});
