import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';

const inbox = readFileSync('legacy/inbox-view.js', 'utf8');
const app = readFileSync('legacy/app.js', 'utf8');
const field = (value = '', original = '') => ({ value, defaultValue: original, type: 'text', tagName: 'INPUT' });
function fixture() {
  const server = GatherStore.createStore({ storage: null });
  const parent = server.addTask({ title: 'Approve QA catering menu', owner: 'jules' });
  server.updateTask(parent.id, { status: 'blocked', note: 'Waiting for dietary restrictions.' }, 'jules');
  let snapshot = server.getState(), changed = true, reads = 0;
  const dialog = { fields: [] }, backdrop = { hidden: false }, notice = { hidden: true };
  const ui = { actor: 'jules', detailId: parent.id, dialogKind: 'task', view: 'tasks' };
  const document = { hidden: false, activeElement: { matches: () => false } };
  const observations = { renders: 0, dialogs: [], pending: 0, closed: 0, markup: '', suggestions: 0, toasts: [] };
  const context = vm.createContext({
    ui, document, window: {},
    $: selector => ({ '#dialog': dialog, '#dialogBackdrop': backdrop, '#workspaceSyncNotice': notice })[selector] || null,
    $$: (_selector, root) => root.fields,
    store: {
      getState: () => snapshot,
      refresh: async canApply => {
        reads++;
        await context.beforeApply?.();
        if (!changed) return { changed: false };
        if (!canApply()) return { pending: true };
        snapshot = server.getState();changed = false;return { changed: true };
      },
    },
    render: () => observations.renders++,
    taskDialog: (...args) => {
      observations.dialogs.push(args);
      observations.markup = context.dependencyMarkup(snapshot.tasks.find(task => task.id === args[0]));
    },
    closeDialog: () => { observations.closed++; backdrop.hidden = true; ui.dialogKind = ''; },
    showPendingUpdate: () => observations.pending++,
    refreshSuggestionSurfaces: () => observations.suggestions++,
    toast: text => observations.toasts.push(text),
    isOrganizer: () => false,
    h: value => String(value ?? '').replaceAll('<', '&lt;'),
    member: id => snapshot.members.find(member => member.id === id) || { name: 'Unassigned' },
    completionText: () => 'Completion reported by Maya', options: () => '',
    statuses: { blocked: 'Blocked', progress: 'In progress', done: 'Done' },
  });
  vm.runInContext(app.slice(app.indexOf('  function hasUnsavedFields('), app.indexOf('  function confirmDiscard(')), context);
  vm.runInContext(app.slice(app.indexOf('  function dependencyInfo('), app.indexOf('  function handoffMarkup(')), context);
  const start = inbox.indexOf('  function canRefreshWorkspace(');
  vm.runInContext(inbox.slice(start < 0 ? inbox.indexOf('  async function refreshInbox(') : start, inbox.indexOf('  let privateOriginalEpoch')), context);
  return { server, parent, context, ui, document, dialog, backdrop, notice, observations,
    reads: () => reads, snapshot: () => snapshot,
    change: () => { changed = true; },
  };
}

test('an untouched open task receives the prerequisite result and resume prompt on refresh', async () => {
  const f = fixture();
  f.server.reportCompletion('dietary', 'Fictional QA: all 20 test guests responded; 3 vegetarian meals.', 'maya');
  await f.context.refreshInbox();
  assert.equal(f.observations.dialogs.length, 1);
  assert.equal(f.observations.dialogs[0][0], f.parent.id);
  assert.match(f.observations.markup, /Ready to resume/);
  assert.match(f.observations.markup, /all 20 test guests responded; 3 vegetarian meals/);
  assert.match(f.observations.markup, /data-action="resume-task"/);
  assert.equal(f.snapshot().tasks.find(task => task.id === f.parent.id).status, 'blocked');
  assert.equal(f.observations.pending, 0);
  assert.equal(f.notice.hidden, true);
  await f.context.refreshInbox();
  assert.equal(f.observations.dialogs.length, 1, 'unchanged polling must not repaint the dialog');
});

test('dirty task fields defer incoming updates until restored without losing the draft', async () => {
  const f = fixture(), draft = field('Do not discard my comment');
  f.dialog.fields.push(draft);
  f.server.reportCompletion('dietary', 'QA dietary results ready.', 'maya');
  await f.context.refreshInbox();
  assert.equal(f.observations.dialogs.length, 0);
  assert.equal(f.observations.pending, 1);
  assert.equal(draft.value, 'Do not discard my comment');
  assert.equal(f.snapshot().tasks.find(task => task.id === 'dietary').status, 'progress');
  draft.value = '';
  await f.context.refreshInbox();
  assert.equal(f.observations.dialogs.length, 1);
  assert.equal(f.notice.hidden, true);
});

test('editing, saving and opening another dialog during a refresh prevents replacement', async () => {
  for (const edit of [
    f => f.dialog.fields.push(field('Typed while request was pending')),
    f => { f.ui.pendingSave = true; },
    f => { f.ui.reviewDirty = true; },
    f => { f.ui.savingProposal = true; },
    f => { f.ui.dialogKind = 'new-task'; },
    f => { f.document.activeElement = { matches: () => true }; },
    f => { f.document.hidden = true; },
  ]) {
    const f = fixture();f.context.beforeApply = () => edit(f);
    await f.context.refreshInbox();
    assert.equal(f.observations.dialogs.length, 0);
    assert.equal(f.observations.pending, 1);
  }
});

test('dirty checkboxes and collapsed task-detail fields also prevent silent rebasing', async () => {
  for (const input of [
    { ...field(), type: 'checkbox', checked: true, defaultChecked: false },
    { ...field('maya', 'jules'), tagName: 'SELECT', options: [{ value: 'jules', defaultSelected: true }, { value: 'maya' }] },
  ]) {
    const f = fixture();f.dialog.fields.push(input);
    await f.context.refreshInbox();
    assert.equal(f.observations.dialogs.length, 0);
    assert.equal(f.notice.hidden, false);
  }
});

test('reopened prerequisites remove the resume prompt from an untouched dialog', async () => {
  const f = fixture();
  f.server.reportCompletion('dietary', 'QA responses ready.', 'maya');
  await f.context.refreshInbox();
  f.server.updateTask('dietary', { status: 'progress', note: 'One fictional response changed.' }, 'jack');
  f.change();await f.context.refreshInbox();
  assert.equal(f.observations.dialogs.length, 2);
  assert.doesNotMatch(f.observations.markup, /Ready to resume|data-action="resume-task"/);
  assert.match(f.observations.markup, /Finish required work/);
});

test('verification-gated completion refreshes the result only after organizer approval', async () => {
  const f = fixture();
  f.server.updateTask('dietary', { requiresVerification: true }, 'jack');
  f.server.reportCompletion('dietary', 'Fictional QA result awaiting approval.', 'maya');
  await f.context.refreshInbox();
  assert.match(f.observations.markup, /Awaiting verification/);
  assert.doesNotMatch(f.observations.markup, /Ready to resume/);
  f.server.verifyTask('dietary', 'jack');f.change();
  await f.context.refreshInbox();
  assert.match(f.observations.markup, /Ready to resume/);
  assert.match(f.observations.markup, /Fictional QA result awaiting approval/);
});

test('task dialog focus supports reading without auto-focusing an editable field', () => {
  const calls = [], frames = [], dialog = { focus: () => calls.push('dialog') };
  const input = { matches: () => true, focus: () => calls.push('input') };
  const backdrop = { hidden: true, dataset: {}, classList: { add() {} } };
  const nodes = { '#dialog': dialog, '#dialogBackdrop': backdrop, '#appShell': {}, '#sidebar': { classList: { contains: () => false } } };
  const context = vm.createContext({
    $: selector => nodes[selector], ui: {}, document: { activeElement: null, body: { style: {} } },
    h: value => value, icon: () => '', focusable: () => [input],
    requestAnimationFrame: callback => frames.push(callback),
  });
  vm.runInContext(app.slice(app.indexOf('  function openDialog('), app.indexOf('  function closeDialog(')), context);
  context.openDialog('Read task', '', '', false, 'task', 'dialog');
  frames.splice(0).forEach(callback => callback());
  assert.deepEqual(calls, ['dialog']);
  context.openDialog('Refresh task', '', '', false, 'task', 'none');
  assert.equal(frames.length, 0, 'refresh restores prior focus instead of scheduling an input focus');
  context.openDialog('Add task', '');
  frames.splice(0).forEach(callback => callback());
  assert.deepEqual(calls, ['dialog', 'input'], 'other forms retain their existing autofocus');
});

test('same-task refresh retains loaded resource DOM and focus, but changed search context reloads it', () => {
  const task = { id: 'qa-task', title: 'Approve menu', category: 'Food', owner: 'maya', status: 'blocked', comments: [] };
  const detail = { className: 'resource-details', open: true };
  const original = { detail }, focus = { kind: 'resource-summary' }, frames = [];
  let resource = original, mounts = 0, restored;
  const dialog = { scrollTop: 320, dataset: {}, focus() { restored = 'dialog'; } };
  const context = vm.createContext({
    store: { getState: () => ({ tasks: [task], event: {} }) },
    ui: { dialogKind: 'task', detailId: task.id, resourceContext: JSON.stringify([task.id, task.title, task.category]), actor: 'jules' },
    document: { activeElement: focus },
    $: selector => selector === '#dialog' ? dialog : selector === '.task-resources' ? resource : null,
    $$: selector => selector.includes('details') ? [resource.detail] : [],
    taskDrafts: () => [], isOrganizer: () => false, dependencyInfo: () => ({ open: [] }),
    openDialog: () => { resource = { detail: { className: 'resource-details', open: false }, replaceWith(node) { resource = node; } }; },
    h: value => value || '', statusBadge: () => '', sourceButton: () => '', member: () => ({ name: 'Maya' }),
    dayLabel: () => '', relative: () => '', schedule: { details: () => '' },
    recovery: { recoveryMarkup: () => '' }, dependencyMarkup: () => '', handoffMarkup: () => '', priorityMarkup: () => '',
    syncRecoveryForms() {}, syncHandoffForm() {}, requestAnimationFrame: callback => frames.push(callback),
    restoreFocus: previous => { restored = previous; return true; },
    window: { GatherResourcesUI: { markup: () => '', mount() { mounts++; } } },
  });
  vm.runInContext(app.slice(app.indexOf('  function taskDialog('), app.indexOf('  function syncRecoveryForms(')), context);
  context.taskDialog(task.id);
  frames.splice(0).forEach(callback => callback());
  assert.equal(resource, original, 'retain the actual node, event handlers and pending search closure');
  assert.equal(resource.detail.open, true);
  assert.equal(restored, focus);
  assert.equal(dialog.scrollTop, 320);
  assert.equal(mounts, 0, 'background task refresh must not restart a search');
  task.title = 'Arrange QA transport';
  context.taskDialog(task.id);
  assert.notEqual(resource, original);
  assert.equal(mounts, 1, 'changed title must load resources for the new search context');
  task.category = 'Transport';
  context.taskDialog(task.id);
  assert.equal(mounts, 2, 'category changes also invalidate reused resources');
});

test('non-task dialogs stay protected and unchanged private screens do not rerender', async () => {
  for (const kind of ['new-task', 'followup', '']) {
    const f = fixture();f.ui.dialogKind = kind;
    await f.context.refreshInbox();
    assert.equal(f.observations.renders, 0);
    assert.equal(f.observations.pending, 1);
  }
  const f = fixture();f.backdrop.hidden = true;f.ui.dialogKind = '';f.ui.view = 'details';
  await f.context.refreshInbox();
  assert.equal(f.observations.renders, 0);
  assert.equal(f.observations.dialogs.length, 0);
});
