import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = name => readFileSync(new URL('../legacy/' + name, import.meta.url), 'utf8');
const date = '2099-10-21', stamp = '2099-10-20T20:00:00Z', actor = 'fictional-owner';
const parent = (id, fields = {}) => ({ id, title: 'Fictional ' + id, owner: actor, status: 'blocked', dueDate: '',
  note: 'FICTIONAL_PRIVATE_BLOCKER', dependencies: [{ taskId: 'dependency', kind: 'dependency', reason: 'FICTIONAL_PRIVATE_REASON' }], ...fields });
const child = (fields = {}) => ({ id: 'dependency', title: 'FICTIONAL_PRIVATE_PREREQUISITE', owner: 'different-owner',
  status: 'done', note: 'FICTIONAL_PRIVATE_RESULT', ...fields });
const notice = (id, kind) => ({ id, title: 'Fictional ' + id, kind });

function projection({ withSchedule = true } = {}) {
  const window = {};
  Object.defineProperty(window, 'localStorage', { get() { assert.fail('Projection must not touch localStorage.'); } });
  if (withSchedule) runInNewContext(source('schedule-ui.js'), { window });
  runInNewContext(source('notifications.cjs'), { window });
  return (tasks, owner = actor, today = date, ...extra) => JSON.parse(JSON.stringify(
    window.WeftNotifications.taskReminders(tasks, owner, today, ...extra)));
}

test('linked results reminders are date independent, owner scoped, identity only and outrank due dates', () => {
  const task = parent('ready-and-due', { dueDate: date });
  const tasks = [child(), task, parent('without-date'), parent('later', { dueDate: '2099-10-31' }),
    parent('ordinary-due', { dependencies: [], dueDate: date }),
    parent('different-owner', { owner: 'different-owner' })];
  const before = structuredClone(tasks), reminders = projection();
  const ready = ['later', 'ready-and-due', 'without-date'].map(id => notice(id, 'linked-results'));
  assert.deepEqual(reminders(tasks), [...ready, { id: 'ordinary-due', title: 'Fictional ordinary-due', dueDate: date, overdue: false }]);
  assert.deepEqual(reminders(tasks, actor, 'invalid date'), ready);
  assert.deepEqual(reminders(tasks, 'different-owner'), [notice('different-owner', 'linked-results')]);
  assert.deepEqual(reminders(tasks, ''), []);
  assert.doesNotMatch(JSON.stringify(reminders(tasks)), /FICTIONAL_PRIVATE|dependsOn|dependencies|dueDate.*ready-and-due/);
  assert.deepEqual(tasks, before);
});

test('completion changes and schedule reconfirmation take precedence without duplicate reminders', () => {
  const scheduleReconfirmation = { owner: actor, timeZone: 'UTC', previous: null };
  const tasks = [child(),
    parent('result', { dueDate: date }),
    parent('schedule-and-result', { dueDate: date, scheduleReconfirmation }),
    parent('returned-and-schedule-and-result', { dueDate: date, scheduleReconfirmation, completionReview: { note: 'FICTIONAL_PRIVATE_REVIEW' } }),
    parent('due', { dependencies: [], dueDate: date }),
  ];
  const expected = [notice('returned-and-schedule-and-result', 'completion-changes'),
    notice('schedule-and-result', 'schedule-reconfirmation'), notice('result', 'linked-results'),
    { id: 'due', title: 'Fictional due', dueDate: date, overdue: false }];
  assert.deepEqual(projection()(tasks), expected);
  assert.deepEqual(projection()(tasks, actor, date, task => task.id === 'schedule-and-result'), expected,
    'the fourth positional argument remains the schedule predicate');
});

test('only still-blocked work with all current required results can show the reminder', () => {
  const reminders = projection(), task = parent('subject');
  const cases = [
    [task], [task, child({ status: 'progress' })], [task, child({ archivedAt: stamp })],
    [task, child({ requiresVerification: true, verifiedAt: '' })],
    [parent('subject', { status: 'progress' }), child()],
    [parent('subject', { status: 'done' }), child()],
    [parent('subject', { archivedAt: stamp }), child()],
    [parent('subject', { requiresVerification: true, reportedAt: stamp }), child()],
    [parent('subject', { dependencies: [{ taskId: 'dependency', kind: 'related' }] }), child()],
    [parent('subject', { dependencies: [...task.dependencies, { taskId: 'unavailable', kind: 'dependency' }] }), child()],
  ];
  for (const tasks of cases) assert.deepEqual(reminders(tasks), []);
  assert.deepEqual(reminders([task, child({ requiresVerification: true, verifiedAt: stamp })]), [notice('subject', 'linked-results')]);
  assert.deepEqual(reminders([parent('subject', { dependencies: [...task.dependencies, { taskId: 'optional', kind: 'related' }] }), child()]),
    [notice('subject', 'linked-results')], 'an unavailable Related task does not block required results');
  assert.deepEqual(projection({ withSchedule: false })([task, child()]), [], 'no predicate means no inferred reminder');
});
