import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../legacy/app.js', import.meta.url), 'utf8');
const sourceId = 'required-source', targetId = 'required-target', otherId = 'same-title-other';
const verifiedAt = '2026-11-18T20:00:00Z';
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const action = 'return-to-completion-linked-impact';

function fixture() {
  const source = { id: sourceId, title: 'Fictional shared result', status: 'done', requiresVerification: true, verifiedAt, revision: 5, dependencies: [] };
  const target = { id: targetId, title: 'Fictional downstream task', status: 'blocked', owner: 'maya', revision: 8,
    dependencies: [{ kind: 'dependency', taskId: sourceId }] };
  const other = { ...structuredClone(target), id: otherId };
  const state = { tasks: [source, target, other], members: [], demoGeneration: undefined };
  const calls = [], frames = [], dialogContexts = [];
  const ui = { actor: 'jack', view: 'tasks', dialogKind: 'task', detailId: sourceId, lastFocus: { name: 'page task opener' } };
  const window = { GatherMode: { projectId: 'fictional-project' }, GatherAccessLost: false };
  const document = { hidden: false, activeElement: null };
  let revision = 12, organizer = true, pending = false, stale = false, dirty = false, allowDiscard = false;
  let form = null, title = null, section = null, impactHeading = null, back = null;
  let rows = [];
  const backdrop = { hidden: false };
  function node(name, opts = {}) {
    const n = { name, dataset: {}, isConnected: true, hidden: false, inert: false, tagName: 'BUTTON', ...opts };
    n.hasAttribute = key => key === 'data-completion-linked-target' && n.impactTarget === true;
    n.closest = selector => selector === 'section' ? n.section ?? null : selector === '[hidden],[inert]' && (n.hidden || n.inert) ? n : null;
    n.matches = selector => selector === ':disabled' ? !!n.disabled : false;
    n.getClientRects = () => n.hidden || n.inert ? [] : [{}];
    n.focus = () => { document.activeElement = n; calls.push(['focus', n.name]); };
    return n;
  }
  const dialog = node('dialog');
  dialog.contains = element => [title, section, impactHeading, back, form, ...rows].includes(element);
  const select = (selector, parent) => {
    if (selector === '#dialog') return dialog;
    if (selector === '#dialogBackdrop') return backdrop;
    if (selector === '#dialogTitle' && (!parent || parent === dialog)) return title;
    if (selector === '#completionLinkedImpactHeading' && (!parent || parent === dialog || parent === section)) return impactHeading;
    if (selector === '#completionLinkedImpactBack' && (!parent || parent === dialog)) return back;
    return null;
  };
  const selectAll = (selector, parent) => (parent === section || parent === dialog) && selector.includes('[data-completion-linked-target]') ? rows : [];
  dialog.querySelector = selector => select(selector, dialog);
  function paint(id) {
    for (const n of [title, section, impactHeading, back, form, ...rows].filter(Boolean)) n.isConnected = false;
    title = node('dialog title ' + id, { id: 'dialogTitle', tagName: 'H2' });
    section = null; impactHeading = null; rows = []; back = null; form = null;
    if (id === sourceId) {
      const task = state.tasks.find(item => item.id === id);
      const current = context.completionLinkedImpact(task, state, state.tasks).shownIds;
      if (current.size) {
        section = node('required by section');
        section.contains = el => rows.includes(el) || el === impactHeading;
        impactHeading = node('required by heading', { section, id: 'completionLinkedImpactHeading', tagName: 'H3' });
        rows = [...current].reverse().map(id => node('row ' + id, { impactTarget: true, dataset: { action: 'task', id } }));
      }
    } else {
      back = node('back', { id: 'completionLinkedImpactBack', dataset: { action } });
      form = node('unsaved dependent draft', { value: 'Keep this fictional unsent draft.', files: [{ name: 'fictional-proof.txt' }] });
    }
    document.activeElement = title;
  }
  const store = { getState: () => state, getSnapshotRevision: () => revision,
    refresh() { assert.fail('return must not fetch or write'); },
    verifyTask() { assert.fail('return must not verify'); },
    resumeTask() { assert.fail('return must not resume'); },
  };
  const context = vm.createContext({ ui, window, document, store, h,
    $: select, $$: selectAll,
    isOrganizer: () => organizer, member: () => ({ name: 'Fictional teammate' }),
    statuses: { todo: 'To do', blocked: 'Blocked', done: 'Done' },
    workspaceUpdatesPending: () => pending, scheduleRevisionIsStale: () => stale,
    scheduleWorkspaceKey: () => JSON.stringify([window.GatherMode?.projectId, window.GatherMode?.demo, state.demoGeneration, ui.actor]),
    relatedBatchInScope: batch => batch.actor === ui.actor && batch.view === ui.view && batch.project === window.GatherMode.projectId,
    overlapComparisonInScope: comparison => comparison.actor === ui.actor && comparison.view === ui.view && comparison.project === window.GatherMode.projectId,
    hiddenByClosedDisclosure: control => !!control.closedDisclosure,
    confirmCloseDialog(keepAssignmentReview) { assert.equal(keepAssignmentReview, true); calls.push(['confirm close']); return !dirty || allowDiscard; },
    focusable: parent => selectAll('[data-completion-linked-target]', parent).filter(row => row.isConnected && !row.hidden && !row.inert),
    showPendingUpdate: () => calls.push(['pending']), toast: message => calls.push(['toast', message]),
    requestAnimationFrame: fn => frames.push(fn),
    focusTaskDialogControl: (target, currentDialog) => { assert.equal(currentDialog, dialog); target?.focus(); },
    taskDialog(...args) {
      calls.push(['task dialog', ...args]);
      dialogContexts.push({ relatedBatch: ui.relatedBatch, overlapComparison: ui.overlapComparison });
      ui.detailId = args[0]; ui.dialogKind = 'task';
      if (args[0] !== sourceId) { ui.relatedBatch = null; ui.overlapComparison = null; ui.overlapReviewDay = ''; }
      paint(args[0]);
    },
    closeDialog() { calls.push(['close']); backdrop.hidden = true; ui.dialogKind = ''; },
  });
  const start = app.indexOf('  function completionLinkedImpact('), end = app.indexOf('  function dependencyMarkup(', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(app.slice(start, end), context);
  paint(sourceId);
  return { source, target, other, state, calls, ui, window, document, backdrop, dialogContexts,
    get form() { return form; }, get back() { return back; }, get title() { return title; },
    set revision(value) { revision = value; }, set organizer(value) { organizer = value; }, set pending(value) { pending = value; },
    set stale(value) { stale = value; }, set dirty(value) { dirty = value; }, set allowDiscard(value) { allowDiscard = value; },
    replaceTitle() { title = node('replacement title'); document.activeElement = title; },
    open() { return context.openCompletionLinkedTarget(targetId, rows.find(row => row.dataset.id === targetId)); },
    returnToReview(opener = back) { return context.returnToCompletionLinkedImpact(opener); },
    flush() { for (const fn of frames.splice(0)) fn(); },
  };
}

const taskCalls = f => f.calls.filter(([kind]) => kind === 'task dialog');
const focused = f => f.calls.filter(([kind]) => kind === 'focus').map(([, name]) => name);

test('Back rebuilds the current source read-only and focuses the exact dependent, not its same-title peer', () => {
  const f = fixture(), originalPageOpener = f.ui.lastFocus;
  assert.equal(f.target.title, f.other.title);
  f.open();
  assert.equal(f.ui.detailId, targetId);
  assert.equal(taskCalls(f)[0].at(-1).readOnly, true);
  assert.equal(f.ui.lastFocus, originalPageOpener);
  const oldBack = f.back;
  // The source can change while reviewing a dependent. Return rebuilds from
  // current data and uses the task ID even when the duplicate renders first.
  f.source.title = 'Fictional result, renamed'; f.source.revision++; f.revision = 13;
  f.target.dependencies.push({ kind: 'dependency', taskId: 'fictional-unfinished-prerequisite' });
  const beforeReturn = structuredClone(f.state);
  f.returnToReview();
  assert.equal(f.ui.detailId, sourceId);
  assert.deepEqual(taskCalls(f).map(call => call[1]), [targetId, sourceId]);
  assert.equal(taskCalls(f)[1].at(-1).readOnly, true);
  assert.deepEqual(f.state, beforeReturn);
  assert.equal(oldBack.isConnected, false);
  assert.equal(f.ui.lastFocus, originalPageOpener);
  f.flush();
  assert.deepEqual(focused(f), ['row ' + targetId]);
  f.returnToReview(oldBack);
  assert.equal(taskCalls(f).length, 2, 'old Back is one-shot and cannot navigate again');
});

test('cancelling Back keeps the exact dependent form, typed text, file, and focus', () => {
  const f = fixture(); f.open();
  f.dirty = true;
  const originalForm = f.form, originalFile = originalForm.files[0];
  const opener = f.back;
  f.document.activeElement = opener;
  f.returnToReview(); f.flush();
  assert.ok(f.calls.some(([kind]) => kind === 'confirm close'));
  assert.equal(f.ui.detailId, targetId);
  assert.equal(f.form, originalForm);
  assert.equal(f.form.files[0], originalFile);
  assert.equal(f.form.value, 'Keep this fictional unsent draft.');
  assert.equal(f.document.activeElement, opener);
  assert.deepEqual(taskCalls(f).map(call => call[1]), [targetId]);
  f.allowDiscard = true;
  f.returnToReview(); f.flush();
  assert.equal(f.ui.detailId, sourceId);
  assert.equal(originalForm.isConnected, false);
  assert.deepEqual(focused(f), ['row ' + targetId]);
});

test('Back never jumps to a different dependent when the original leaves Required by', () => {
  for (const noGroup of [false, true]) {
    const f = fixture(); f.open();
    f.target.dependencies[0].kind = 'related';
    if (noGroup) f.other.dependencies = [];
    f.returnToReview(); f.flush();
    assert.equal(f.ui.detailId, sourceId);
    assert.equal(f.document.activeElement.name, noGroup ? 'dialog title ' + sourceId : 'required by heading');
    assert.ok(!focused(f).includes('row ' + otherId));
  }
});

test('only the current visible Back control can leave the exact live review', () => {
  for (const [label, alter] of Object.entries({
    'detached control': f => { f.back.isConnected = false; },
    'hidden control': f => { f.back.hidden = true; },
    'copied control': f => ({ ...f.back }),
    'wrong action': f => { f.back.dataset.action = 'resume-task'; },
    'closed backdrop': f => { f.backdrop.hidden = true; },
    'wrong actor': f => { f.ui.actor = 'maya'; },
    'wrong view': f => { f.ui.view = 'timeline'; },
    'wrong project': f => { f.window.GatherMode.projectId = 'different-project'; },
    'different task': f => { f.ui.detailId = otherId; },
    'lost access': f => { f.window.GatherAccessLost = true; },
    'lost organizer role': f => { f.organizer = false; },
    'new demo generation': f => { f.state.demoGeneration = 'new-demo'; },
    'hidden document': f => { f.document.hidden = true; },
    'pending save': f => { f.ui.pendingSave = true; },
  })) {
    const f = fixture(); f.open();
    const opener = alter(f) || f.back;
    f.returnToReview(opener); f.flush();
    assert.deepEqual(taskCalls(f).map(call => call[1]), [targetId], label);
    assert.deepEqual(focused(f), [], label);
  }
});

test('queued focus cannot target a replaced dialog, another actor, or steal focus the user has moved', () => {
  for (const [label, alter] of Object.entries({
    'replaced title': f => f.replaceTitle(),
    'moved focus': f => { f.document.activeElement = f.ui.lastFocus; },
    'new project': f => { f.window.GatherMode.projectId = 'different-project'; },
    'new actor': f => { f.ui.actor = 'maya'; },
    'closed dialog': f => { f.backdrop.hidden = true; },
    'hidden document': f => { f.document.hidden = true; },
    'advanced revision': f => { f.revision = 13; },
    'updates pending': f => { f.pending = true; },
  })) {
    const f = fixture(); f.open(); f.returnToReview();
    assert.equal(f.ui.detailId, sourceId, label);
    alter(f); f.flush();
    assert.deepEqual(focused(f), [], label);
  }
});

test('stale or unavailable source leaves the current dependent and its draft in place without a prompt', () => {
  for (const [label, alter, message] of [
    ['known stale', f => { f.stale = true; }, /Refresh the project/],
    ['updates pending', f => { f.pending = true; }, /Refresh the project/],
    ['deleted source', f => { f.state.tasks.shift(); }, /no longer available/],
    ['archived source', f => { f.source.archivedAt = verifiedAt; }, /no longer available/],
  ]) {
    const f = fixture(); f.open(); f.dirty = true;
    const original = f.form;
    alter(f);
    f.returnToReview(); f.flush();
    assert.equal(f.ui.detailId, targetId, label);
    assert.equal(f.form, original, label);
    assert.equal(taskCalls(f).length, 1, label);
    assert.ok(!f.calls.some(([kind]) => kind === 'confirm close'), label);
    assert.match(f.calls.find(([kind]) => kind === 'toast')?.[1], message, label);
  }
});

test('the real close confirmation keeps outer assignment selections but retains the unconfirmed-completion warning', () => {
  const start = app.indexOf('  function confirmCloseDialog('), end = app.indexOf('  const unsavedDialog=', start);
  assert.ok(start >= 0 && end > start);
  const messages = [], dialog = {};
  let unconfirmed = false, discard = false;
  const context = vm.createContext({
    $: selector => selector === '#dialog' ? dialog : selector.includes('data-completion-save-unconfirmed') && unconfirmed ? {} : null,
    window: { confirm(message) { messages.push(message); return false; } },
    hasAcceptanceReturnDraft: () => true,
    confirmDiscard(root) { assert.equal(root, dialog); discard = true; return false; },
  });
  vm.runInContext(app.slice(start, end), context);
  assert.equal(context.confirmCloseDialog(true), false);
  assert.equal(discard, true, 'Back still checks unsaved fields in the dependent dialog');
  assert.deepEqual(messages, [], 'Back does not claim the outer assignment selections will be discarded');
  assert.equal(context.confirmCloseDialog(), false);
  assert.match(messages.pop(), /discard your selections/);
  discard = false; unconfirmed = true;
  assert.equal(context.confirmCloseDialog(true), false);
  assert.equal(discard, false);
  assert.match(messages.pop(), /edits may have saved.*reload the project to check/);
});

test('Back restores the source day and scoped outer contexts, but never an unavailable overlap origin', () => {
  for (const variant of ['current', 'deleted origin', 'archived origin', 'mismatched scopes']) {
    const f = fixture();
    const originId = 'fictional-comparison-origin', day = '2026-11-18';
    const origin = { id: originId, status: 'progress', dependencies: [] };
    f.state.tasks.push(origin);
    const scope = { actor: f.ui.actor, view: f.ui.view, project: f.window.GatherMode.projectId };
    const batch = { ...scope, parentId: sourceId, ids: [targetId], childId: '' };
    const comparison = { ...scope, originId, peerId: sourceId };
    if (variant === 'mismatched scopes') { batch.project = 'other-project'; comparison.view = 'timeline'; }
    Object.assign(f.ui, { overlapReviewDay: day, overlapComparison: comparison, relatedBatch: batch });
    f.open();
    assert.equal(f.ui.overlapReviewDay, '', variant);
    assert.equal(f.ui.relatedBatch, null, variant);
    assert.equal(f.ui.overlapComparison, null, variant);
    batch.ids.push('not-in-the-original-batch');
    if (variant === 'deleted origin') f.state.tasks.pop();
    if (variant === 'archived origin') origin.archivedAt = verifiedAt;
    f.returnToReview(); f.flush();
    assert.equal(f.ui.detailId, sourceId, variant);
    assert.equal(taskCalls(f)[1].at(-2), day, variant);
    assert.equal(taskCalls(f)[1].at(-1).readOnly, true, variant);
    const restored = f.dialogContexts[1];
    assert.equal(restored.overlapComparison, variant === 'current' ? comparison : null, variant);
    if (variant === 'mismatched scopes') assert.equal(restored.relatedBatch, null, variant);
    else {
      assert.notEqual(restored.relatedBatch, batch, variant);
      assert.deepEqual([...restored.relatedBatch.ids], [targetId], variant);
    }
    assert.deepEqual(focused(f), ['row ' + targetId], variant);
  }
});
