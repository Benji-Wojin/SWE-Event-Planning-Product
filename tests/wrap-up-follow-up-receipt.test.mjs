import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('legacy/app.js', 'utf8');
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const actor = 'fictional-maya';
const project = 'fictional-event';
const lessonId = 'saved-lesson-1';
const taskId = 'created-task-1';
const task = { id: taskId, title: 'Check <loading area>', owner: '', status: 'todo', note: 'NOT FOR THE RECEIPT', scope: 'DO NOT SHOW ACCEPTANCE CRITERIA' };
const other = { id: 'another-task', title: 'An unrelated task', owner: actor, status: 'todo' };

function fragment(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}

function fixture() {
  const calls = [], frames = [];
  const window = { GatherMode: { projectId: project }, GatherAccessLost: false };
  const document = { body: { style: {} }, activeElement: null };
  const ui = { view: 'memory', actor, wrapMine: true, detailId: '', dialogKind: '' };
  const state = { tasks: [{ ...task }, { ...other }], memories: [] };
  function node(name, data = {}, attrs = {}) {
    return { name, dataset: data, children: [], isConnected: true, hidden: false, inert: false, ...attrs,
      append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } return this; },
      contains(child) { for (let el = child; el; el = el.parentElement) if (el === this) return true; return false; },
      matches(selector) {
        if (selector === '[hidden],[inert]') return this.hidden || this.inert;
        if (selector === ':disabled') return !!this.disabled;
        if (selector[0] === '#') return this.id === selector.slice(1);
        if (selector === 'button') return this.tagName === 'BUTTON';
        const key = selector.match(/^\[data-([a-z-]+)(?:="([^"]*)")?\]$/);
        if (!key) return false;
        const property = key[1].replace(/-([a-z])/g, (_, char) => char.toUpperCase());
        return key[2] === undefined ? Object.hasOwn(this.dataset, property) : this.dataset[property] === key[2];
      },
      closest(selector) { for (let el = this; el; el = el.parentElement) if (el.matches(selector)) return el; return null; },
      getClientRects() { return this.hidden ? [] : [{}]; },
      focus() { document.activeElement = this; calls.push(['focus', this.name]); },
      querySelector(selector) { return query(selector, this)[0] ?? null; },
    };
  }
  const root = node('view'), backdrop = node('backdrop', {}, { hidden: true, classList: { remove() {} } });
  const dialog = node('dialog', {}, { replaceChildren() {} }), shell = node('shell');
  function query(selector, from = root) {
    const all = from.children.flatMap(function walk(child) { return [child, ...child.children.flatMap(walk)]; });
    return all.filter(el => el.matches(selector));
  }
  const context = vm.createContext({ ui, document, window, h,
    $: (selector, from = root) => ({ '#viewRoot': root, '#dialogBackdrop': backdrop, '#appShell': shell, '#dialog': dialog }[selector] ?? query(selector, from)[0] ?? null),
    $$: query, requestAnimationFrame: callback => frames.push(callback), store: { getState: () => state },
    taskDialog(...args) { calls.push(['task', ...args]); ui.detailId = args[0]; ui.dialogKind = 'task'; backdrop.hidden = false; },
    focusScheduleTarget: el => (el.focus(), true), isScheduleControl: () => false,
    restoreFocus: () => false, restoreViewFocus: () => false,
    render: () => calls.push(['render']), toast: message => calls.push(['toast', message]),
    canCreateTasks: () => true, isOrganizer: () => true, timeLabel: () => '', icon: () => '',
    pageHeading: (...args) => args[3], GatherWrapUp: { markup: () => '<main data-wrap-review></main>' }, empty: message => message,
  });
  return { ui, state, window, document, root, backdrop, calls, context, node,
    flush() { for (const frame of frames.splice(0)) frame(); },
    evaluate(start, end) { vm.runInContext(fragment(start, end), context); },
    mount(...children) {
      for (const child of root.children) { child.parentElement = null; child.isConnected = false; }
      root.children = [];
      root.append(...children);
    },
  };
}

function receiptFixture() {
  const f = fixture();
  f.ui.wrapFollowUpReceipt = { actor, project, taskId, lessonId };
  f.evaluate('  const wrapLessonHeadingId=', '  function reminderScope(');
  f.evaluate('  function isActionableLesson(', '  function openLessonFollowUp(');
  f.evaluate('  function closeDialog(', '  function openOrganizerReview(');
  f.evaluate('  function focusWrapLesson(', '  function thoughtDialog(');
  return f;
}

test('the receipt identifies the current saved task without exposing task or lesson details', () => {
  const f = receiptFixture();
  const receipt = () => f.context.wrapFollowUpReceiptMarkup(f.state);
  let html = receipt();
  assert.match(html, /Follow-up task added/);
  assert.match(html, /Check &lt;loading area&gt;/);
  assert.match(html, /Open added task/);
  assert.match(html, /Unassigned/);
  assert.match(html, /Not shown in My tasks/);
  assert.match(html, /id="wrapFollowUpOpen"[^>]*data-id="created-task-1"/);
  assert.doesNotMatch(html, /<loading area>|NOT FOR THE RECEIPT|DO NOT SHOW ACCEPTANCE CRITERIA|An unrelated task/);

  f.state.tasks[0] = { ...task, title: 'Updated task title', owner: actor };
  html = receipt();
  assert.match(html, /Updated task title/);
  assert.doesNotMatch(html, /Check &lt;loading area&gt;|Not shown in My tasks|Unassigned/);
  f.state.tasks[0].owner = 'fictional-teammate';
  assert.match(receipt(), /Not shown in My tasks/);
  f.ui.wrapMine = false;
  assert.doesNotMatch(receipt(), /Not shown in My tasks/);
  f.state.tasks.shift();
  assert.doesNotMatch(receipt(), /wrapFollowUpOpen|Open added task|Follow-up task added/);
});

test('a saved follow-up is not shown to a different account or project, or after access loss', () => {
  for (const change of [
    f => { f.ui.actor = 'fictional-teammate'; },
    f => { f.window.GatherMode.projectId = 'different-event'; },
    f => { f.window.GatherAccessLost = true; },
  ]) {
    const f = receiptFixture();
    change(f);
    assert.equal(f.context.wrapFollowUpReceiptMarkup(f.state), '');
  }
});

test('Wrap up renders exactly one receipt at its source lesson, or above the review when that lesson is gone', () => {
  const f = receiptFixture();
  f.state.memories = [
    { id: 'other-lesson', change: 'Another lesson', active: true },
    { id: lessonId, change: 'Source lesson', active: true },
  ];
  const html = f.context.memoryView(f.state);
  assert.equal(Array.from(html.matchAll(/id="wrapFollowUpHeading"/g)).length, 1);
  const source = html.match(/<article[^>]*data-id="saved-lesson-1"[^>]*>[\s\S]*?<\/article>/)?.[0];
  assert.match(source, /Follow-up task added/);
  f.state.memories.pop();
  const noLesson = f.context.memoryView(f.state);
  assert.equal(Array.from(noLesson.matchAll(/id="wrapFollowUpHeading"/g)).length, 1);
  assert.ok(noLesson.indexOf('id="wrapFollowUpHeading"') < noLesson.indexOf('data-wrap-review'));
});

function receiptButton(f, id = taskId, attrs = {}) {
  return f.node('open added task', { action: 'open-wrap-follow-up', id }, { id: 'wrapFollowUpOpen', tagName: 'BUTTON', ...attrs });
}

test('only the live matching receipt button can open task details, with no automatic resource request', () => {
  for (const invalidate of [
    (f, button) => { button.isConnected = false; },
    (f, button) => { button.hidden = true; },
    (f, button) => { f.mount(receiptButton(f)); button.isConnected = true; },
    (f, button) => { button.dataset.id = other.id; },
    f => { f.state.tasks.shift(); },
    f => { f.ui.view = 'tasks'; },
    f => { f.ui.actor = 'different-user'; },
    f => { f.window.GatherMode.projectId = 'different-event'; },
    f => { f.window.GatherAccessLost = true; },
    f => { f.backdrop.hidden = false; },
  ]) {
    const f = receiptFixture(), button = receiptButton(f);
    f.mount(button);
    invalidate(f, button);
    assert.equal(f.context.openWrapFollowUpReceipt(taskId, button), false);
    assert.equal(f.calls.some(([type]) => type === 'task'), false);
  }
  const f = receiptFixture(), button = receiptButton(f);
  f.mount(button);
  assert.equal(f.context.openWrapFollowUpReceipt(taskId, button), true);
  const args = f.calls.find(([type]) => type === 'task');
  assert.deepEqual(args.slice(0, -1), ['task', taskId, '', false, true, '', undefined, '']);
  assert.equal(args.at(-1).readOnly, true);
  assert.equal(f.ui.lastFocus, button);
  assert.equal(f.ui.wrapMine, true);
});

test('closing task details focuses the same current receipt after repaint, not a different task', () => {
  const f = receiptFixture(), original = receiptButton(f);
  f.mount(original);
  assert.equal(f.context.openWrapFollowUpReceipt(taskId, original), true);
  const replacement = receiptButton(f), unrelated = f.node('unrelated action', { id: other.id }, { tagName: 'BUTTON' });
  f.mount(unrelated, replacement);
  f.context.closeDialog();
  f.flush();
  assert.deepEqual(f.calls.filter(([type]) => type === 'focus'), [['focus', replacement.name]]);
  assert.equal(f.document.activeElement, replacement);
  assert.equal(f.ui.lastFocus, null);
  assert.equal(f.ui.wrapMine, true);
});

test('a missing task falls back to its source lesson, and only the live dismiss button clears the receipt', () => {
  const f = receiptFixture(), open = receiptButton(f);
  const heading = f.node('original lesson', { wrapLesson: lessonId });
  const dismiss = f.node('dismiss', { action: 'dismiss-wrap-follow-up', id: taskId }, { id: 'wrapFollowUpDismiss', tagName: 'BUTTON' });
  f.mount(heading, open, dismiss);
  f.context.dismissWrapFollowUpReceipt(taskId, { ...dismiss });
  assert.equal(f.ui.wrapFollowUpReceipt.taskId, taskId);
  f.context.dismissWrapFollowUpReceipt(taskId, dismiss);
  assert.equal(f.ui.wrapFollowUpReceipt, null);
  assert.deepEqual(f.calls.splice(0), [['render'], ['focus', 'original lesson']]);
  assert.equal(f.ui.wrapMine, true);

  f.ui.wrapFollowUpReceipt = { actor, project, taskId, lessonId };
  f.state.tasks.shift();
  assert.equal(f.context.openWrapFollowUpReceipt(taskId, open), false);
  assert.equal(f.document.activeElement, heading);
  assert.equal(f.calls.some(([type]) => type === 'task'), false);
});

test('a redraw restores Dismiss itself and a task remount from the live receipt stays read-only', () => {
  const f = receiptFixture();
  f.evaluate('  function restoreViewFocus(', '  function saveLock(');
  const dismiss = name => f.node(name, { action: 'dismiss-wrap-follow-up', id: taskId }, { id: 'wrapFollowUpDismiss', tagName: 'BUTTON' });
  const previous = dismiss('old dismiss'), current = dismiss('current dismiss');
  f.mount(previous);
  f.mount(receiptButton(f), current);
  f.document.activeElement = f.document.body;
  assert.equal(f.context.restoreViewFocus(previous, f.root), true);
  assert.deepEqual(f.calls.splice(0), [['focus', 'current dismiss']]);

  const button = f.root.querySelector('#wrapFollowUpOpen');
  assert.equal(f.context.openWrapFollowUpReceipt(taskId, button), true);
  f.window.GatherResourcesUI = { mount: (id, _, options) => f.calls.push(['resources', id, options.readOnly]) };
  const resourceTail = fragment('    const fromWrapReceipt=', '    if((batch||ui.overlapComparison||');
  vm.runInContext(`function remountResources(id,taskState,readOnly=false) {${resourceTail}}`, f.context);
  f.context.remountResources(taskId, f.state);
  f.context.remountResources(other.id, f.state);
  f.ui.lastFocus = null;
  f.context.remountResources(taskId, f.state);
  assert.deepEqual(f.calls.filter(([action]) => action === 'resources'), [
    ['resources', taskId, true], ['resources', other.id, false], ['resources', taskId, false],
  ]);
});
