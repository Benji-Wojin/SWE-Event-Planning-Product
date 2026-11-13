import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/schedule-ui.js';

const now = '2026-11-20T17:15:00Z', day = '2026-11-20', tomorrow = '2026-11-21', zone = 'America/Los_Angeles';
const first = { start: day + 'T09:00', end: day + 'T09:30', location: 'Fictional first-assignment room' };
const earlier = { start: day + 'T06:00', end: day + 'T07:00', location: 'PRIVATE-OLD-LOCATION' };
const latest = { start: day + 'T09:05', end: day + 'T09:35', location: 'Fictional current room' };
const future = { start: tomorrow + 'T09:05', end: tomorrow + 'T09:35', location: 'Fictional later room' };
const cue = 'Schedule changed · owner needs to accept again';
const reviewTitle = 'Schedule changes awaiting owner acceptance';
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const ui = GatherScheduleUI.create({ h, options: () => '', statusBadge: status => '<span>' + h(status) + '</span>' });

function fixture() {
  const store = GatherStore.createStore({ storage: null, now: Date.parse(now) });
  store.completeSetup({ timeZone: zone });
  const ids = new Set();
  const add = (title, owner, slot, patch = {}) => {
    const task = store.addTask({ title, owner, eventActivity: true, schedule: slot, note: 'PRIVATE-TASK-NOTE', ...patch });
    ids.add(task.id);
    return task.id;
  };
  const change = (title, owner, slot, patch) => {
    const id = add(title, owner, earlier, patch);
    store.acceptTask(id, owner);
    store.setTaskSchedule(id, slot);
    return id;
  };
  const snapshot = () => {
    const s = store.getState();
    return { ...s, tasks: s.tasks.filter(task => ids.has(task.id)) };
  };
  return { store, add, change, snapshot };
}

const ids = (groups, key) => groups.find(group => group.key === key)?.tasks.map(task => task.id) ?? [];
const groupMarkup = (html, key) => html.match(new RegExp('<details[^>]+data-event-review-group="' + key + '"[^>]*>[\\s\\S]*?<\\/details>'))?.[0] ?? '';
const rowMarkup = (html, id) => [...html.matchAll(/<button\b[^>]*data-id="([^"]+)"[^>]*>[\s\S]*?<\/button>/g)]
  .filter(([, candidate]) => candidate === id).map(([tag]) => tag);

test('Before the event distinguishes renewed acceptance, keeps unscheduled changes, and preserves owner scope', () => {
  const f = fixture();
  const firstId = f.add('First-time activity', 'maya', first);
  const changed = f.change('Changed activity <today>', 'maya', latest);
  const other = f.change('Other owner’s changed activity', 'dev', future);
  const removed = f.change('Removed from schedule', 'maya', null, { eventActivity: undefined });
  const s = f.snapshot(), before = f.store.exportState();
  const all = GatherScheduleUI.reviewItems(s, now, { actor: 'jack', date: day });
  assert.deepEqual(new Set(ids(all, 'schedule-reconfirmation')), new Set([changed, other, removed]));
  assert.deepEqual(ids(all, 'acceptance'), [firstId]);
  const personal = GatherScheduleUI.reviewItems(s, now, { mine: true, actor: 'maya', date: day });
  assert.deepEqual(new Set(ids(personal, 'schedule-reconfirmation')), new Set([changed, removed]));
  assert.deepEqual(ids(personal, 'acceptance'), [firstId]);
  const html = ui.preparationReview(s, now, { actor: 'jack', date: day }, true);
  const group = groupMarkup(html, 'schedule-reconfirmation');
  assert.match(group, new RegExp(reviewTitle + ' · 3'));
  assert.match(group, /Changed activity &lt;today&gt;[\s\S]*Nov 20, 2026/);
  assert.match(group, /Other owner’s changed activity[\s\S]*Nov 21, 2026/);
  assert.match(group, /America\/Los_Angeles/);
  assert.match(group, /Removed from schedule[\s\S]*Not on the schedule/);
  assert.doesNotMatch(group, /First-time activity|PRIVATE-OLD-LOCATION|PRIVATE-TASK-NOTE|6:00 AM|data-action="(?:accept-task|assign|toggle-task)"|<form/);
  const mine = groupMarkup(ui.preparationReview(s, now, { mine: true, actor: 'maya' }, false), 'schedule-reconfirmation');
  assert.match(mine, /Changed activity/);
  assert.match(mine, /Removed from schedule/);
  assert.doesNotMatch(mine, /Other owner/);
  assert.equal(f.store.exportState(), before);
});

test('Timeline clock and dated rows replace only the renewed-acceptance cue and never export the old slot', () => {
  const f = fixture();
  const initial = f.add('First-time activity', 'maya', first);
  const changed = f.change('Current changed activity', 'dev', latest);
  const later = f.change('Later changed activity', 'dev', future);
  const s = f.snapshot(), scope = { actor: 'jack', date: day };
  const clock = ui.clock(s, now, scope, true).markup, dated = ui.view(s, true, now, scope);
  for (const html of [clock, dated]) {
    const initialRows = rowMarkup(html, initial), changedRows = rowMarkup(html, changed);
    assert.ok(initialRows.length > 0 && changedRows.length > 0);
    assert.ok(initialRows.every(row => row.includes('Acceptance not recorded') && !row.includes(cue)));
    assert.ok(changedRows.every(row => row.includes(cue) && !row.includes('Acceptance not recorded')));
    assert.equal(rowMarkup(html, later).length, 0);
    assert.doesNotMatch(html, /PRIVATE-OLD-LOCATION|PRIVATE-TASK-NOTE|6:00 AM|data-action="(?:accept-task|assign|toggle-task)"/);
  }
  const mine = ui.view(s, true, now, { mine: true, actor: 'maya', date: day });
  assert.doesNotMatch(mine, new RegExp(cue));
  assert.equal(rowMarkup(mine, changed).length, 0);
  const next = ui.view(s, true, now, { actor: 'jack', date: tomorrow });
  assert.ok(rowMarkup(next, later).some(row => row.includes(cue)));
  const model = ui.runSheetModel(s, now, scope);
  assert.ok(model.days[0].rows.every(row => row.acceptance === 'Acceptance not recorded'));
  for (const output of [ui.runSheetMarkup(model), ui.runSheetText(model)])
    assert.doesNotMatch(output, /Schedule changed · owner needs to accept again|PRIVATE-OLD-LOCATION|PRIVATE-TASK-NOTE|6:00 AM/);
});

test('acceptance, reassignment and unavailable owners resolve or replace schedule reconfirmation without stale labels', () => {
  const f = fixture();
  const accepted = f.change('Reaccepted', 'maya', latest);
  const reassigned = f.change('Reassigned', 'maya', latest);
  const reported = f.change('Reported', 'maya', latest, { requiresVerification: true });
  const unavailable = f.change('Inactive owner', 'dev', latest);
  f.store.acceptTask(accepted, 'maya');
  f.store.updateTask(reassigned, { owner: 'jack' });
  f.store.reportCompletion(reported, 'Fictional complete.', 'maya');
  const s = f.snapshot();
  s.members.find(member => member.id === 'dev').active = false;
  const all = GatherScheduleUI.reviewItems(s, now);
  assert.deepEqual(ids(all, 'schedule-reconfirmation'), []);
  assert.deepEqual(ids(all, 'acceptance'), [reassigned]);
  assert.deepEqual(ids(all, 'owner-unavailable'), [unavailable]);
  assert.ok(ids(all, 'verification').includes(reported));
  const review = groupMarkup(ui.preparationReview(s, now, { actor: 'jack' }, true), 'schedule-reconfirmation');
  assert.match(review, new RegExp(reviewTitle + ' · 0'));
  assert.doesNotMatch(ui.view(s, true, now, { actor: 'jack', date: day }), new RegExp(cue));
});
