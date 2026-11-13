import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/priorities.js';
import '../legacy/planning-ui.js';
import '../legacy/recovery-ui.js';

const source = readFileSync('legacy/app.js', 'utf8');
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const day = '2026-11-20';
const reviewAfter = '2026-11-21';
const replyText = 'FICTIONAL REQUEST REPLY';
const get = (store, id) => store.getState().tasks.find(task => task.id === id);
const ask = (store, id, actor = 'maya') => store.requestRecovery(id, { kind: 'help', note: 'Fictional request' }, actor);
const decide = (store, id, data = {}) => store.resolveRecovery(id, {
  action: 'checkin', requestId: GatherPriorities.pendingRequest(get(store, id)).id, note: replyText, reviewAfter, ...data,
}, 'jack');

function fixture() {
  let now = Date.parse(day + 'T18:00:00Z');
  const store = GatherStore.createStore({ storage: null, now: () => now });
  const ui = { view: 'tasks', taskView: 'list', tab: 'mine', actor: 'maya' };
  const member = id => store.getState().members.find(item => item.id === id);
  const recovery = GatherRecoveryUI.create({ store, ui, h, options: () => '', dayLabel: h, member });
  const context = vm.createContext({
    ui, store, recovery, window: globalThis, h, member, GatherPriorities, GatherPlanningUI, guideTaskId: '',
    isOrganizer: () => ui.actor === 'jack', icon: name => `<i>${h(name)}</i>`, person: id => h(member(id)?.name),
    statusBadge: status => `<span class="status-badge">${h(status)}</span>`, due: task => h(task.dueDate),
    completionText: () => 'Completed', timeLabel: h, relative: h,
    dependencyInfo: task => ({ open: GatherPriorities.unresolved(task, store.getState().tasks) }),
  });
  vm.runInContext(source.slice(source.indexOf('  const noteUpdate = '), source.indexOf('  const toast = ')) +
    source.slice(source.indexOf('  const completionNeedsReview = '), source.indexOf('  const empty = ')) +
    '\nglobalThis.row = taskRow;', context);
  return { store, ui, render: id => context.row(get(store, id)), advance: () => { now += 60_000; } };
}

const details = row => row.match(/<td\b[^>]*class="task-cell-details"[^>]*>\s*(<button\b[\s\S]*?<\/button>)\s*<\/td>/)?.[1] || '';
const identity = button => Object.fromEntries(['action', 'id', 'task-focus'].map(key => [key, button.match(new RegExp('data-' + key + '="([^"]+)"'))?.[1]]));
const hasReply = /\bdata-open-recovery-reply\b|Review organizer response/;

test('My tasks keeps a review link for a blocked request after its reply is no longer the latest comment', () => {
  const { store, render, advance } = fixture();
  const prerequisite = store.addTask({ title: 'Fictional prerequisite', owner: 'dev' });
  const task = store.addTask({
    title: 'Check <fictional pickup> & "signage"', owner: 'maya', status: 'blocked', dueDate: day,
    dependencies: [{ taskId: prerequisite.id, kind: 'dependency', reason: 'Pickup requires the route check.' }],
  });
  const ordinary = details(render(task.id));
  const expectedIdentity = { action: 'task', id: task.id, 'task-focus': 'details' };
  assert.deepEqual(identity(ordinary), expectedIdentity);
  assert.doesNotMatch(ordinary, hasReply);
  ask(store, task.id);
  assert.doesNotMatch(details(render(task.id)), hasReply);
  decide(store, task.id);
  advance();
  store.addComment(task.id, 'A teammate adds a later route note.', 'dev');
  const before = store.exportState(), row = render(task.id), action = details(row);
  assert.match(row, /A teammate adds a later route note/);
  assert.doesNotMatch(row, /FICTIONAL REQUEST REPLY|<fictional pickup>|data-action="resume-task"/);
  assert.match(action, /data-open-recovery-reply/);
  assert.match(action, />Review organizer response<\/button>/);
  assert.match(action, /aria-label="Review organizer response[^\"]*Check &lt;fictional pickup&gt; &amp; &quot;signage&quot;"/);
  assert.deepEqual(identity(action), expectedIdentity, 'passive render can restore the same task Details control');
  assert.match(row, /class="status-badge">blocked<\/span>/);
  assert.deepEqual(GatherPriorities.unresolved(get(store, task.id), store.getState().tasks).map(link => link.taskId), [prerequisite.id]);
  assert.equal(store.exportState(), before);
});

test('reply affordance is requester-owned and My tasks only, with current state and access checks', t => {
  const { store, render, ui } = fixture();
  const { id } = store.addTask({ title: 'Fictional plan', owner: 'maya', dueDate: day });
  const action = () => details(render(id));
  ask(store, id);
  decide(store, id);
  assert.match(action(), /data-open-recovery-reply/);
  for (const tab of ['all', 'attention', 'done']) {
    ui.tab = tab;
    assert.doesNotMatch(action(), hasReply, tab);
  }
  ui.tab = 'mine';
  const original = globalThis.GatherAccessLost, hadFlag = Object.hasOwn(globalThis, 'GatherAccessLost');
  t.after(() => { if (hadFlag) globalThis.GatherAccessLost = original; else delete globalThis.GatherAccessLost; });
  globalThis.GatherAccessLost = true;
  assert.doesNotMatch(action(), hasReply);
  globalThis.GatherAccessLost = false;

  ask(store, id);
  assert.doesNotMatch(action(), hasReply, 'a newer pending request replaces the old reply');
  store.updateTask(id, { dueDate: reviewAfter }, 'jack');
  assert.doesNotMatch(action(), hasReply, 'a superseded request must not uncover the old reply');

  ask(store, id);
  decide(store, id, { action: 'reassign', owner: 'jules' });
  for (const actor of ['maya', 'jules', 'jack']) {
    ui.actor = actor;
    assert.doesNotMatch(action(), hasReply, actor);
  }

  ui.actor = 'jules';
  ask(store, id, 'jules');
  decide(store, id);
  store.reportCompletion(id, 'Fictional work done.', 'jules');
  assert.equal(get(store, id).status, 'done');
  assert.match(action(), /data-open-recovery-reply/, 'completed My tasks can still show the last explicit reply');
});
