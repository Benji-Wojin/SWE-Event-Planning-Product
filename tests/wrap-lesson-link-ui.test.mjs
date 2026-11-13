import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/wrap-up.js';

const source = readFileSync('legacy/app.js', 'utf8');
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const actor = 'fictional-organizer', project = 'fictional-project';
const lesson = (id, fields = {}) => ({ id, change: `Lesson ${id}`, active: true, scope: 'always', ...fields });
const task = (id, memoryId, fields = {}) => ({ id, title: 'Same <task> title', memoryId, owner: 'fictional-teammate', status: 'progress', ...fields });

function fragment(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}

function fixture() {
  const calls = [], frames = [];
  const state = { tasks: [task('linked-a', 'lesson-a'), task('linked-b', 'lesson-a'), task('linked-c', 'lesson-b')],
    memories: [lesson('lesson-a'), lesson('lesson-b', { active: false })] };
  const ui = { view: 'memory', actor, wrapMine: true, detailId: '', dialogKind: '' };
  const window = { GatherMode: { projectId: project }, GatherAccessLost: false };
  const document = { body: { style: {} }, activeElement: null };
  function node(name, dataset = {}, attrs = {}) {
    return { name, dataset, children: [], isConnected: true, hidden: false, inert: false, ...attrs,
      append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } return this; },
      contains(child) { for (let el = child; el; el = el.parentElement) if (el === this) return true; return false; },
      matches(selector) {
        if (selector === '[hidden],[inert]') return this.hidden || this.inert;
        if (selector === ':disabled') return !!this.disabled;
        if (selector === 'button') return this.tagName === 'BUTTON';
        if (selector.startsWith('#')) return this.id === selector.slice(1);
        const fields = [...selector.matchAll(/\[data-([a-z-]+)(?:="([^"]*)")?\]/g)];
        return fields.length > 0 && fields.every(([, name, value]) => {
          const key = name.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
          return value === undefined ? Object.hasOwn(this.dataset, key) : this.dataset[key] === value;
        });
      },
      closest(selector) { for (let el = this; el; el = el.parentElement) if (el.matches(selector)) return el; return null; },
      getClientRects() { return this.hidden ? [] : [{}]; },
      focus() { document.activeElement = this; calls.push(['focus', this.name]); },
      querySelector(selector) { return query(selector, this)[0] ?? null; },
    };
  }
  const root = node('view'), shell = node('shell'), backdrop = node('backdrop', {}, { hidden: true, classList: { remove() {} } });
  const dialog = node('dialog', {}, { replaceChildren() {} });
  function query(selector, from = root) {
    const all = from.children.flatMap(function walk(child) { return [child, ...child.children.flatMap(walk)]; });
    return all.filter(el => el.matches(selector));
  }
  const context = vm.createContext({ ui, state, window, document, h, $$: query,
    $: (selector, from = root) => ({ '#viewRoot': root, '#dialogBackdrop': backdrop, '#appShell': shell, '#dialog': dialog }[selector] ?? query(selector, from)[0] ?? null),
    canCreateTasks: () => true, isOrganizer: () => true, icon: () => '', timeLabel: () => '', empty: value => value,
    pageHeading: (...args) => args[3], GatherWrapUp: { ...globalThis.GatherWrapUp, markup: () => '<main data-wrap-review></main>' },
    statuses: { todo: 'To do', progress: 'In progress', blocked: 'Blocked', done: 'Done' },
    statusBadge: status => `<span>${({ todo: 'To do', progress: 'In progress', blocked: 'Blocked', done: 'Done' })[status]}</span>`,
    store: { getState: () => state }, requestAnimationFrame: callback => frames.push(callback),
    taskDialog(...args) { calls.push(['task', ...args]); ui.detailId = args[0]; ui.dialogKind = 'task'; backdrop.hidden = false; },
    focusScheduleTarget: el => (el.focus(), true), isScheduleControl: () => false,
    restoreFocus: () => false, hiddenByClosedDisclosure: () => false,
    render: () => calls.push(['render']), toast: message => calls.push(['toast', message]),
  });
  vm.runInContext([
    fragment('  const wrapLessonHeadingId=', '  function reminderScope('),
    fragment('  function isActionableLesson(', '  function openLessonFollowUp('),
    fragment('  function focusWrapLesson(', '  function thoughtDialog('),
    fragment('  function closeDialog(', '  function openOrganizerReview('),
    fragment('  function restoreViewFocus(', '  function saveLock('),
  ].join(''), context);
  return { calls, state, ui, window, document, root, backdrop, context, node,
    mount(...children) {
      function disconnect(el) { el.isConnected = false; for (const child of el.children) disconnect(child); }
      for (const child of root.children) { child.parentElement = null; disconnect(child); }
      root.children = [];
      root.append(...children);
    },
    flush() { for (const frame of frames.splice(0)) frame(); },
  };
}

const cardMarkup = (html, id) => html.match(new RegExp(`<article[^>]*data-id="${id}"[^>]*>[\\s\\S]*?</article>`))?.[0];
const linkIds = html => [...(html || '').matchAll(/<button[^>]*data-action="open-lesson-linked-task"[^>]*data-id="([^"]+)"[^>]*>/g)].map(([, id]) => id);

test('redrawing the same lesson-linked task keeps automatic resource generation disabled', () => {
  const f = fixture();
  f.window.GatherResourcesUI = { mount: (id, _, options) => f.calls.push(['resources', id, options.readOnly]) };
  const tail = fragment('    const fromWrapReceipt=', '    if((batch||ui.overlapComparison||');
  vm.runInContext(`function remountResources(id,taskState,readOnly=false) {${tail}}`, f.context);
  f.ui.lastFocus = f.node('lesson shortcut', {action: 'open-lesson-linked-task', id: 'linked-a', lessonId: 'lesson-a'});
  f.context.remountResources('linked-a', f.state);
  f.context.remountResources('linked-b', f.state);
  f.ui.lastFocus = null;
  f.context.remountResources('linked-a', f.state);
  assert.deepEqual(f.calls, [['resources', 'linked-a', true], ['resources', 'linked-b', false], ['resources', 'linked-a', false]]);
});

test('lesson links use exact task association across task scopes and retired lessons', () => {
  const f = fixture();
  f.state.tasks[0].note = 'FICTIONAL_TASK_PRIVATE_NOTE';
  f.state.tasks[0].completionEvidence = { note: 'FICTIONAL_PRIVATE_EVIDENCE' };
  f.state.tasks[2].status = 'done';
  f.state.tasks.push(task('archived-link', 'lesson-a', { archivedAt: '2030-01-01T00:00Z' }), task('other', 'not-in-project'));
  const before = structuredClone(f.state);
  for (const wrapMine of [true, false]) {
    f.ui.wrapMine = wrapMine;
    const html = f.context.memoryView(f.state);
    const a = cardMarkup(html, 'lesson-a'), b = cardMarkup(html, 'lesson-b');
    assert.match(a, /data-wrap-lesson-tasks/);
    assert.deepEqual(linkIds(a), ['linked-a', 'linked-b']);
    assert.deepEqual(linkIds(b), ['linked-c']);
    assert.match(a, /Same &lt;task&gt; title[\s\S]*In progress/);
    assert.match(b, /Retired[\s\S]*Same &lt;task&gt; title[\s\S]*(?:Done|Complete)/);
    assert.doesNotMatch(b, /draft-lesson-follow-up/);
    assert.doesNotMatch(html, /archived-link|not-in-project|FICTIONAL_(?:TASK_PRIVATE_NOTE|PRIVATE_EVIDENCE)|Same <task> title/);
  }
  assert.deepEqual(f.state, before);
});

test('the lesson shortcut announces its source and does not label unverified completion as Done', () => {
  const f = fixture();
  f.state.tasks[0].status = 'done';
  f.state.tasks[0].requiresVerification = true;
  const html = cardMarkup(f.context.memoryView(f.state), 'lesson-a');
  assert.match(html, /aria-describedby="wrap-lesson-lesson-a wrap-lesson-lesson-a-task-state-0"/);
  assert.match(html, /id="wrap-lesson-lesson-a-task-state-0"><span[^>]*>Awaiting organizer verification/);
  assert.doesNotMatch(html, />Done</);
});

test('the active save receipt suppresses only its duplicate lesson link until dismissal', () => {
  const f = fixture();
  f.ui.wrapFollowUpReceipt = { actor, project, taskId: 'linked-a', lessonId: 'lesson-a' };
  const render = () => f.context.memoryView(f.state);
  let html = render();
  assert.match(cardMarkup(html, 'lesson-a'), /id="wrapFollowUpOpen"[^>]*data-id="linked-a"/);
  assert.deepEqual(linkIds(cardMarkup(html, 'lesson-a')), ['linked-b']);
  assert.deepEqual(linkIds(cardMarkup(html, 'lesson-b')), ['linked-c']);
  f.ui.wrapFollowUpReceipt = null;
  html = render();
  assert.doesNotMatch(html, /id="wrapFollowUpOpen"/);
  assert.deepEqual(linkIds(cardMarkup(html, 'lesson-a')), ['linked-a', 'linked-b']);
  assert.deepEqual(linkIds(cardMarkup(html, 'lesson-b')), ['linked-c']);
});

function controls(f, lessonId, taskId, name) {
  const card = f.node(`card ${lessonId}`, { wrapLessonCard: '', id: lessonId });
  const heading = f.node(`heading ${lessonId}`, { wrapLesson: lessonId });
  const button = f.node(name, { action: 'open-lesson-linked-task', id: taskId, lessonId }, { tagName: 'BUTTON' });
  card.append(heading, f.node('linked tasks', { wrapLessonTasks: '' }).append(button));
  return { card, heading, button };
}

test('opening requires a live lesson control and its current exact task relationship', () => {
  for (const invalidate of [
    (f, control) => { control.button.isConnected = false; },
    (f, control) => { control.button.hidden = true; },
    (f, control) => { control.button.dataset.lessonId = 'lesson-b'; },
    (f, control) => { control.card.dataset.id = 'lesson-b'; },
    f => { f.state.tasks[0].memoryId = 'lesson-b'; },
    f => { f.state.tasks[0].archivedAt = '2030-01-01T00:00Z'; },
    f => { f.state.tasks.shift(); },
    f => { f.state.memories.shift(); },
    f => { f.ui.view = 'tasks'; },
    f => { f.window.GatherAccessLost = true; },
    f => { f.backdrop.hidden = false; },
  ]) {
    const f = fixture(), control = controls(f, 'lesson-a', 'linked-a', 'source link');
    f.mount(control.card);
    invalidate(f, control);
    assert.equal(f.context.openLessonLinkedTask('linked-a', control.button), false);
    assert.equal(f.calls.some(([type]) => type === 'task'), false);
  }
  const f = fixture(), { card, button } = controls(f, 'lesson-b', 'linked-c', 'retired lesson link');
  f.mount(card);
  assert.equal(f.context.openLessonLinkedTask('linked-c', button), true);
  const args = f.calls.find(([type]) => type === 'task');
  assert.equal(args[1], 'linked-c');
  assert.equal(args.at(-1).readOnly, true);
  assert.equal(f.ui.lastFocus, button);
  assert.equal(f.ui.wrapMine, true);
});

test('return focus prefers the exact replacement and falls back to the same lesson heading', () => {
  for (const survives of [true, false]) {
    const f = fixture();
    const original = controls(f, 'lesson-a', 'linked-a', 'original link');
    f.mount(original.card);
    assert.equal(f.context.openLessonLinkedTask('linked-a', original.button), true);
    const other = controls(f, 'lesson-b', 'linked-a', 'same task ID under a different lesson');
    const target = controls(f, 'lesson-a', survives ? 'linked-a' : 'linked-b', 'current source link');
    f.mount(other.card, target.card);
    if (!survives) f.state.tasks.shift();
    f.context.closeDialog();
    f.flush();
    assert.deepEqual(f.calls.filter(([type]) => type === 'focus'), [['focus', survives ? target.button.name : target.heading.name]]);
  }
});

test('a background repaint restores only the matching linked-task control', () => {
  const f = fixture();
  const prior = controls(f, 'lesson-a', 'linked-a', 'prior control');
  f.mount(prior.card);
  prior.button.focus();
  const other = controls(f, 'lesson-b', 'linked-a', 'same task ID under a different lesson');
  const current = controls(f, 'lesson-a', 'linked-a', 'matching control');
  f.mount(other.card, current.card);
  f.document.activeElement = f.document.body;
  assert.equal(f.context.restoreViewFocus(prior.button, f.root), true);
  assert.equal(f.document.activeElement, current.button);
});
