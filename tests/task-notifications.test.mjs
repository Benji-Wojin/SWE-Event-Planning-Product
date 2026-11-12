import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

const browserModule = readFileSync(new URL('../legacy/notifications.cjs', import.meta.url), 'utf8');
const calendar = readFileSync(new URL('../legacy/calendar.js', import.meta.url), 'utf8');
function browser(storage) {
  const window = {};
  Object.defineProperty(window, 'localStorage', { get: () => storage() });
  runInNewContext(calendar, { window });
  runInNewContext(browserModule, { window });
  return window;
}

test('local preference is off by default and saves only an isolated opt-in', async () => {
  const result = await build({entryPoints:['lib/notification-scope.ts'], bundle:true, write:false, platform:'node', format:'esm'});
  const { notificationScope } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  const account = 'google:fictional-account';
  const project = 'p_fictional';
  const scope = notificationScope(account, project);
  const anotherAccount = notificationScope('google:fictional-other', project);
  const anotherProject = notificationScope(account, 'p_other');
  assert.equal(notificationScope(account, project), scope);
  assert.equal(new Set([scope, anotherAccount, anotherProject]).size, 3);
  assert.match(scope, /^[a-f0-9]{64}$/);
  const values = new Map();
  const storage = {getItem: key => values.get(key), setItem: (key,value) => values.set(key,value), removeItem: key => values.delete(key)};
  const api = browser(() => storage).WeftNotifications;
  assert.equal(api.readReminderPreference(scope), false);
  assert.equal(api.writeReminderPreference(scope, true), true);
  assert.deepEqual([...values], [['weft-task-reminders:v1:' + scope, '1']]);
  assert.equal(browser(() => storage).WeftNotifications.readReminderPreference(scope), true);
  assert.equal(api.readReminderPreference(anotherAccount), false);
  assert.equal(api.readReminderPreference(anotherProject), false);
  assert.equal(api.writeReminderPreference(scope, false), true);
  assert.equal(values.size, 0);
  assert.equal(api.writeReminderPreference(account, true), false);
  assert.equal(values.size, 0);
});

test('unavailable browser storage fails closed and never claims a save', () => {
  const api = browser(() => { throw new Error('Storage unavailable'); }).WeftNotifications;
  const scope = 'b'.repeat(64);
  assert.equal(api.readReminderPreference(scope), false);
  assert.equal(api.writeReminderPreference(scope, true), false);
  assert.equal(api.writeReminderPreference(scope, false), false);
});

test('due reminders reflect only this account’s open assignments and the project calendar day', () => {
  const { GatherCalendar, WeftNotifications } = browser(() => null);
  const now = Date.parse('2026-11-12T05:30:00Z');
  const task = (id, dueDate, extra = {}) => ({ id, title: id, owner:'jack', status:'todo', dueDate, note:'unrelated task content', ...extra });
  const tasks = [
    task('tomorrow','2026-11-12'),
    task('today','2026-11-11'),
    task('other-account','2026-11-10',{owner:'maya'}),
    task('done','2026-11-10',{status:'done'}),
    task('no-date',''),
    task('blocked','2026-11-09',{status:'blocked'}),
    task('reported','2026-11-10',{reportedAt:'2026-11-10T00:00:00Z',requiresVerification:true}),
    task('archived','2026-11-10',{archivedAt:'2026-11-10T00:00:00Z'}),
  ];
  const pacific = GatherCalendar.dayKey(now, 'America/Los_Angeles');
  assert.equal(pacific, '2026-11-11');
  assert.deepEqual(JSON.parse(JSON.stringify(WeftNotifications.taskReminders(tasks, 'jack', pacific))), [
    { id:'blocked', title:'blocked', dueDate:'2026-11-09', overdue:true },
    { id:'today', title:'today', dueDate:'2026-11-11', overdue:false },
  ]);
  assert.deepEqual(Array.from(WeftNotifications.taskReminders(tasks, 'maya', pacific), r => r.id), ['other-account']);
  const nextDay = GatherCalendar.dayKey(now, 'America/New_York');
  assert.equal(nextDay, '2026-11-12');
  assert.deepEqual(Array.from(WeftNotifications.taskReminders(tasks, 'jack', nextDay), r => [r.id,r.overdue]), [
    ['blocked',true], ['today',true], ['tomorrow',false],
  ]);
});
