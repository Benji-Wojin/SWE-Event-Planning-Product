import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/priorities.js';
import '../legacy/recovery-ui.js';
import '../legacy/schedule-ui.js';

const app = readFileSync(new URL('../legacy/app.js', import.meta.url), 'utf8');
const actor = 'maya', project = 'fictional-project', id = 'parent-task';
const title = 'Review <West & East>', note = 'Fictional saved update; keep verbatim.';
const stamp = '2026-11-20T22:00:00Z';
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const copy = value => structuredClone(value);
function taskFixture(extra = {}) {
  return { id, title, owner: actor, status: 'blocked', note, revision: 7, dueDate: '2026-11-24',
    dependencies: [{ kind: 'dependency', taskId: 'required', reason: 'Fictional link context' }], ...extra };
}
function functionSource(name) {
  const start = app.search(new RegExp(`^  (?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `missing ${name}`);
  const from = app.indexOf('\n', start) + 1;
  const end = app.slice(from).search(/^  (?:async function|function|const|let) /m);
  assert.ok(end >= 0, `missing end for ${name}`);
  return app.slice(start, from + end);
}

const savedTask = (extra = {}) => taskFixture({ status: 'progress', revision: 8, ...extra });
function fixture({ initial = taskFixture(), linked = false } = {}) {
  const state = { event: { timeZone: 'America/Los_Angeles' }, tasks: [copy(initial), { id: 'required', status: 'done' }] };
  const ui = { actor, view: 'tasks', dialogKind: 'task', detailId: id,
    ...(linked ? { linkedResultsReview: { id, actor, project } } : {}) };
  const document = { activeElement: null, hidden: false }, window = { GatherMode: { projectId: project } };
  const calls = [], frames = [];
  let pending, stale = false, knownNewer = false, protectedDraft = false;
  const node = (name, options = {}) => ({ name, isConnected: true, dataset: {},
    closest: selector => selector === '[hidden],[inert]' && options.hidden ? {} : null, ...options });
  const backdrop = { hidden: false }, dialog = { contains: candidate => candidate === resume };
  let dialogTitle = node('dialog title');
  const resume = node('Resume task', { dataset: { id, action: 'resume-task' } });
  const shortcut = node('Go to Next up controls', { dataset: { id, action: 'show-resumed-next-up' } });
  const receiptHeading = node('receipt heading'), nextState = node('Next up state');
  const nextForm = node('Next up form', { dataset: { id } });
  let visibleShortcut = shortcut, visibleNextState = nextState;
  const store = { getState: () => state, getSnapshotRevision: () => 22,
    resumeTask(...args) {
      calls.push(['write resume', ...args]);
      return new Promise((resolve, reject) => {
        pending = { reject, resolve(result, current = result) {
          state.tasks[0] = copy(current);
          resolve(result);
        } };
      });
    },
    setNextUp() { assert.fail('No automatic or shortcut Next up commitment.'); },
    refresh() { assert.fail('Reviewing the receipt cannot refresh the project.'); },
  };
  document.activeElement = dialogTitle;
  const context = vm.createContext({ ui, window, document, store, h, GatherPriorities, GatherScheduleUI,
    $: (selector, parent) => {
      if (parent === dialog) return ({ '#dialogTitle': dialogTitle, '#resumeTaskReceiptHeading': receiptHeading,
        '[data-action="show-resumed-next-up"]': visibleShortcut, '#nextUpForm': nextForm })[selector] ?? null;
      if (parent === nextForm) return selector === '#nextUpTaskState' ? visibleNextState : null;
      return ({ '#dialogBackdrop': backdrop, '#dialog': dialog, '#dialogTitle': dialogTitle })[selector] ?? null;
    },
    personalLinkedResults: current => current.tasks.filter(task => task.owner === ui.actor &&
      GatherScheduleUI.linkedResultsReady(task, new Map(current.tasks.map(item => [item.id, item])))),
    workspaceUpdatesPending: () => stale, scheduleRevisionIsStale: () => knownNewer,
    protectCompletionDraft(task, action) {
      assert.equal(task.id, id); assert.equal(action, 'resume'); return !protectedDraft;
    },
    showPendingUpdate: () => calls.push(['show pending']),
    toast: message => calls.push(['toast', message]), render: () => calls.push(['render']),
    taskDialog(...args) {
      calls.push(['task dialog', ...args]);
      dialogTitle = node('fresh dialog title'); document.activeElement = dialogTitle;
    },
    focusTaskDialogControl(target, container) {
      if (!target) return;
      assert.equal(container, dialog); document.activeElement = target; calls.push(['focus', target.name]);
    },
    requestAnimationFrame: callback => frames.push(callback),
  });
  const handlerStart = app.indexOf("      if(action==='resume-task'){");
  const handlerEnd = app.indexOf("      if(action==='unlink-dependency')", handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'real delegated resume case');
  const handler = app.slice(handlerStart, handlerEnd);
  const helpers = ['currentResumeReceipt', 'resumedNextUpAvailable', 'resumeTaskReceipt', 'showResumedNextUp'].map(functionSource);
  vm.runInContext(`${helpers.join('\n')}\nasync function act(action,id,el) {${handler}}`, context);
  return { state, ui, window, document, backdrop, calls, resume, shortcut, nextForm, nextState, receiptHeading,
    get pending() { return pending; }, set stale(value) { stale = value; }, set knownNewer(value) { knownNewer = value; },
    set protectedDraft(value) { protectedDraft = value; },
    replaceDialogTitle() { dialogTitle = node('replacement dialog title'); document.activeElement = dialogTitle; },
    replaceShortcut() { visibleShortcut = { ...shortcut }; },
    removeNextState() { visibleNextState = null; },
    markReceipt() { ui.resumeReceipt = { id, actor, project, revision: state.tasks[0].revision }; },
    html: () => context.resumeTaskReceipt(state.tasks[0], state),
    save: () => context.act('resume-task', id, resume),
    go: (taskId = id, opener = shortcut) => context.showResumedNextUp(taskId, opener),
    flush() { for (const frame of frames.splice(0)) frame(); },
  };
}

test('an exact saved Resume is acknowledged in the same dialog without altering Next up or the previous update', async () => {
  assert.match(functionSource('taskDialog'), /\$\{resumeTaskReceipt\(task,taskState\)\}/);
  const f = fixture({ linked: true });
  const pending = f.save();
  assert.deepEqual(f.calls, [['write resume', id, actor]]);
  assert.equal(f.resume.disabled, true);
  assert.equal(f.html(), '');
  f.pending.resolve(savedTask());
  await pending;
  assert.deepEqual(f.calls, [['write resume', id, actor], ['render'], ['task dialog', id, '', false, true], ['toast', 'Task resumed.']]);
  assert.equal(f.resume.disabled, false);
  assert.deepEqual({ ...f.ui.resumeReceipt }, { id, actor, project, revision: 8 });
  assert.equal(f.state.tasks[0].note, note);
  assert.equal(f.state.tasks[0].nextUpAt, undefined);
  const html = f.html();
  assert.match(html, /id="resumeTaskReceiptHeading" tabindex="-1">Task resumed/);
  assert.match(html, /Status is now In progress\. The previous update and linked results were kept/);
  assert.match(html, /This task was not added to Next up/);
  assert.match(html, /data-action="show-resumed-next-up" data-id="parent-task">Go to Next up controls/);
  assert.doesNotMatch(html, /<form|Fictional saved update|Fictional link context/);
  f.flush();
  assert.equal(f.document.activeElement, f.receiptHeading);
  const before = copy(f.state);
  assert.equal(f.go(), true);
  assert.equal(f.document.activeElement, f.nextState);
  assert.deepEqual(f.state, before);
  assert.equal(f.calls.filter(([kind]) => kind === 'write resume').length, 1);
});

test('unconfirmed, failed, or superseded Resume never displays or focuses a receipt', async () => {
  for (const [reason, result, current] of [
    ['wrong task', savedTask({ id: 'same-title-peer' }), savedTask()],
    ['wrong status', savedTask({ status: 'blocked' }), savedTask()],
    ['unchanged task revision', savedTask({ revision: 7 }), savedTask({ revision: 7 })],
    ['newer published task', savedTask(), savedTask({ revision: 9 })],
    ['published task not resumed', savedTask(), savedTask({ status: 'blocked' })],
  ]) {
    const f = fixture(), pending = f.save();
    f.pending.resolve(result, current);
    await assert.rejects(pending, /Could not confirm the task resumed/, reason);
    f.flush();
    assert.equal(f.html(), '', reason);
    assert.deepEqual(f.calls, [['write resume', id, actor]], reason);
    assert.equal(f.resume.disabled, false, reason);
  }
  const failed = fixture(), rejected = failed.save();
  failed.pending.reject(new Error('Fictional response unavailable'));
  await assert.rejects(rejected, /Fictional response unavailable/);
  assert.equal(failed.html(), '');
  assert.equal(failed.resume.disabled, false);

  const replaced = fixture(), late = replaced.save();
  replaced.replaceDialogTitle();
  replaced.pending.resolve(savedTask());
  await late;
  replaced.flush();
  assert.deepEqual(replaced.calls, [['write resume', id, actor]], 'late acknowledgment must not repaint a replacement dialog');
  assert.equal(replaced.html(), '');
});

test('the receipt preserves outstanding help/date/schedule cues and only offers existing Next up eligibility', () => {
  const next = /data-action="show-resumed-next-up"/;
  for (const [name, fields, shown, message] of [
    ['already committed', { nextUpAt: stamp }, false],
    ['other owner', { owner: 'fictional-teammate' }, false],
    ['completion returned', { completionReview: {} }, false],
    ['help request', { recoveryRequests: [{ kind: 'help', status: 'pending' }] }, false, /help request is still waiting/],
    ['date proposal', { recoveryRequests: [{ kind: 'date', status: 'pending' }] }, true, /date proposal is still waiting/],
    ['schedule reconfirmation', { scheduleReconfirmation: { owner: actor, previous: null, timeZone: 'UTC' } }, false, /owner still needs to review and accept the schedule change/],
  ]) {
    const f = fixture({ initial: savedTask(fields) });
    f.markReceipt();
    assert.match(f.html(), /Task resumed/, name);
    assert.equal(next.test(f.html()), shown, name);
    if (message) assert.match(f.html(), message, name);
    assert.equal(f.go(), shown, name);
  }
});

test('the exact Next up focus shortcut rejects stale state, a replacement control, or the wrong dialog', () => {
  for (const [name, invalidate] of Object.entries({
    'actor changed': f => { f.ui.actor = 'another-teammate'; }, 'project changed': f => { f.window.GatherMode.projectId = 'new-project'; },
    'task changed': f => { f.state.tasks[0].revision++; }, 'task archived': f => { f.state.tasks[0].archivedAt = stamp; },
    'wrong dialog': f => { f.ui.detailId = 'same-title-peer'; }, 'closed dialog': f => { f.backdrop.hidden = true; },
    'detached': f => { f.shortcut.isConnected = false; }, 'replacement': f => f.replaceShortcut(),
    'wrong form': f => { f.nextForm.dataset.id = 'same-title-peer'; }, 'missing Next up state': f => f.removeNextState(),
    'hidden tab': f => { f.document.hidden = true; }, 'save in progress': f => { f.ui.pendingSave = true; },
    'pending workspace': f => { f.stale = true; }, 'known newer workspace': f => { f.knownNewer = true; },
    'prerequisite reopened': f => { f.state.tasks[1].status = 'todo'; },
  })) {
    const f = fixture({ initial: savedTask() });
    f.markReceipt(); invalidate(f);
    assert.equal(f.go(), false, name);
    assert.ok(!f.calls.some(([kind]) => kind === 'focus' || kind === 'write resume'), name);
  }
});
