import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = file => readFileSync(new URL('../legacy/' + file, import.meta.url), 'utf8');
const app = read('app.js'), calendar = read('calendar.js'), schedule = read('schedule-ui.js'), notifications = read('notifications.cjs');
const actor = 'fictional-teammate', today = '2026-11-19', recorded = '2026-11-18T20:00:00Z';
const title = 'Review <West & East>', eligibleId = 'fictional-ready';
const link = (taskId, kind = 'dependency') => ({ taskId, kind, reason: 'FICTIONAL_PRIVATE_LINK_REASON' });
const task = (id, extra = {}) => ({ id, title: id, owner: actor, status: 'blocked', dueDate: '',
  dependencies: [link('verified-required')], note: 'FICTIONAL_PRIVATE_TASK_NOTE', ...extra });
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const plain = value => JSON.parse(JSON.stringify(value));

function stateFixture() {
  return { event: { timeZone: 'America/Los_Angeles' }, members: [{ id: actor, name: 'Fictional teammate' }], tasks: [
    task(eligibleId, { title, dueDate: today, dependencies: [link('verified-required'), link('unverified-required', 'related')] }),
    task('verified-required', { status: 'done', requiresVerification: true, verifiedAt: recorded, dependencies: [] }),
    task('unverified-required', { status: 'done', requiresVerification: true, dependencies: [] }),
    task('archived-required', { status: 'done', archivedAt: recorded, dependencies: [] }),
    task('other-owner', { owner: 'someone-else' }),
    task('related-only', { dependencies: [link('verified-required', 'related')] }),
    task('needs-verification', { dependencies: [link('unverified-required')] }),
    task('requires-archived', { dependencies: [link('archived-required')] }),
    task('requires-missing', { dependencies: [link('unknown-task')] }),
    task('archived-blocked', { archivedAt: recorded }),
    task('no-longer-blocked', { status: 'progress' }),
    task('waiting-for-verification', { requiresVerification: true, reportedAt: recorded }),
    task('completion-returned', { completionReview: { note: 'FICTIONAL_PRIVATE_RETURN_REASON' }, dueDate: today }),
    task('schedule-changed', { scheduleReconfirmation: { owner: actor, previous: null }, dueDate: today }),
    task('ordinary-due', { dueDate: today, status: 'todo' }),
  ] };
}

function functionSource(name) {
  const head = `  function ${name}(`, start = app.indexOf(head);
  assert.ok(start >= 0, `missing ${name}`);
  const following = app.slice(start + head.length).search(/^  (?:async function|function|const|let) /m);
  assert.ok(following >= 0, `missing end for ${name}`);
  return app.slice(start, start + head.length + following);
}

function fixture({ view = 'overview', tab = 'all', fromNotifications = false, optedIn = true } = {}) {
  const state = stateFixture(), calls = [], frames = [];
  const ui = { actor, view, tab, dialogKind: fromNotifications ? 'notifications' : '', detailId: '' };
  const document = { activeElement: null, hidden: false };
  const scope = 'c'.repeat(64);
  const window = { GatherMode: { projectId: 'fictional-project' }, GatherAccessLost: false,
    localStorage: { getItem: () => optedIn ? '1' : null, setItem: () => assert.fail('unexpected preference write') } };
  let pending = false, stale = false;
  function node(name, dataset = {}, options = {}) {
    return { name, dataset, tagName: 'DIV', isConnected: true, hidden: false, inert: false, children: [], ...options,
      append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } return this; },
      contains(child) { for (let el = child; el; el = el.parentElement) if (el === this) return true; return false; },
      hasAttribute(attr) { return this.matches(`[${attr}]`); },
      matches(selector) {
        if (selector === ':disabled') return !!this.disabled;
        if (selector === '[hidden],[inert]') return this.hidden || this.inert;
        if (selector === 'button' || selector === 'h1') return this.tagName === selector.toUpperCase();
        if (selector.startsWith('#')) return this.id === selector.slice(1);
        if (selector === '.task-dependencies h3') return this.name === 'linked results heading';
        const fields = [...selector.matchAll(/\[data-([a-z-]+)(?:="([^"]*)")?\]/g)];
        return fields.length > 0 && fields.every(([, name, value]) => {
          const key = name.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
          return value === undefined ? Object.hasOwn(this.dataset, key) : this.dataset[key] === value;
        });
      },
      closest(selector) { for (let el = this; el; el = el.parentElement) if (el.matches(selector)) return el; return null; },
      querySelector(selector) { return query(selector, this)[0] ?? null; },
      querySelectorAll(selector) { return query(selector, this); },
      getClientRects() { return this.hidden ? [] : [{}]; },
      focus() { document.activeElement = this; calls.push(['focus', this.name]); },
    };
  }
  function query(selector, from) {
    function walk(el) { return [el, ...el.children.flatMap(walk)]; }
    return from.children.flatMap(walk).filter(el => el.matches(selector));
  }
  const root = node('view', {}, { id: 'viewRoot' });
  const backdrop = node('backdrop', {}, { id: 'dialogBackdrop', hidden: !fromNotifications });
  const dialog = node('dialog', {}, { id: 'dialog' }), list = node('notification list', { notificationItems: '' });
  const bell = node('notification bell', {}, { id: 'notificationButton', tagName: 'BUTTON' });
  const dependencyHeading = node('linked results heading');
  const pageHeading = node('page heading', {}, { tagName: 'H1' });
  const panelHeading = node('panel heading', {}, { id: 'linkedResultsHeading' });
  let dialogTitle = node('dialog title', {}, { id: 'dialogTitle' });
  const control = (id = eligibleId, extra = {}) => node('review ' + id,
    { action: 'review-linked-results', id, ...extra }, { tagName: 'BUTTON' });
  const opener = control(eligibleId, fromNotifications ? { notificationTask: '' } : {});
  const panel = node('linked results panel', { linkedResults: view, linkedResultsActor: actor });
  root.append(pageHeading, panel);
  panel.append(panelHeading);
  if (fromNotifications) list.append(opener);
  else panel.append(opener);
  dialog.append(dialogTitle, list, dependencyHeading);
  const store = { getState: () => state, getSnapshotRevision: () => 21, getReminderScope: () => scope,
    refresh: () => assert.fail('opening results must not refresh remotely'),
    resumeTask: () => assert.fail('opening results must not resume the task'),
    updateTask: () => assert.fail('opening results must not write the task'),
  };
  const context = vm.createContext({ state, ui, window, document, store, h,
    $: (selector, from) => from ? query(selector, from)[0] ?? null :
      [root, backdrop, dialog, bell, dialogTitle].find(el => el.matches(selector)) ?? query(selector, root)[0] ?? query(selector, dialog)[0] ?? null,
    $$: (selector, from = root) => query(selector, from),
    requestAnimationFrame: callback => frames.push(callback),
    focusable: from => query('button', from).filter(node => node.isConnected && !node.closest('[hidden],[inert]')),
    workspaceUpdatesPending: () => pending, scheduleRevisionIsStale: () => stale,
    hiddenByClosedDisclosure: () => false, dateKey: () => today, statusBadge: value => h(value),
    isOrganizer: () => false, icon: () => '',
    render: () => calls.push(['render']), paintNotifications: () => calls.push(['paint notifications']),
    showPendingUpdate: () => calls.push(['pending update']),
    toast: message => calls.push(['toast', message]), focusTaskDialogControl: target => target?.focus(),
    focusScheduleTarget: target => { target?.focus(); return !!target; },
    taskDialog(...args) {
      calls.push(['task', ...args]); ui.detailId = args[0]; ui.dialogKind = 'task'; backdrop.hidden = false;
      document.activeElement = dialogTitle;
    },
  });
  for (const source of [calendar, schedule, notifications]) vm.runInContext(source, context);
  context.GatherScheduleUI = window.GatherScheduleUI;
  vm.runInContext(['linkedResultsPanel', 'personalLinkedResults', 'openLinkedResults', 'reminderScope', 'restoreLinkedResultsFocus'].map(functionSource).join('\n'), context);
  return { state, ui, window, document, calls, root, panel, dialog, backdrop, opener, bell, list, dependencyHeading, control, pageHeading, panelHeading,
    get dialogTitle() { return dialogTitle; },
    set pending(value) { pending = value; }, set stale(value) { stale = value; },
    replaceTitle() { dialog.children.shift(); dialogTitle = node('new dialog title', {}, { id: 'dialogTitle' }); dialog.append(dialogTitle); },
    flush() { for (const callback of frames.splice(0)) callback(); },
    html: () => context.linkedResultsPanel(state), open: (id = eligibleId, button = opener) => context.openLinkedResults(id, button),
    restore: () => context.restoreLinkedResultsFocus(opener, root),
  };
}

test('personal linked-results reminders are date-independent, identity-only, and never duplicate stronger cues', () => {
  const f = fixture(), before = structuredClone(f.state);
  const result = (owner, day) => plain(f.window.WeftNotifications.taskReminders(f.state.tasks, owner, day));
  const actionable = [
    { id: 'completion-returned', title: 'completion-returned', kind: 'completion-changes' },
    { id: 'schedule-changed', title: 'schedule-changed', kind: 'schedule-reconfirmation' },
    { id: eligibleId, title, kind: 'linked-results' },
  ];
  assert.deepEqual(result(actor, today), [...actionable, { id: 'ordinary-due', title: 'ordinary-due', dueDate: today, overdue: false }]);
  assert.deepEqual(result(actor, 'no-date'), actionable);
  assert.deepEqual(result('', today), []);
  assert.deepEqual(f.state, before);
});

test('Overview and Shared tasks surface only current personal results and say the task is still blocked', () => {
  for (const [view, tab] of [['overview', 'all'], ['tasks', 'all'], ['tasks', 'mine']]) {
    assert.match(functionSource(view === 'overview' ? 'overview' : 'tasksView'), /\$\{linkedResultsPanel\(s\)\}/);
    const f = fixture({ view, tab }), before = structuredClone(f.state);
    const html = f.html();
    assert.match(html, /data-linked-results data-linked-results-actor="fictional-teammate"/);
    assert.match(html, /<h2[^>]+>Review linked results<\/h2>/);
    assert.match(html, /Still blocked · Review results/);
    assert.match(html, /aria-label="Review linked results for Review &lt;West &amp; East&gt;"/);
    const ids = [...html.matchAll(/data-action="review-linked-results" data-id="([^"]+)"/g)].map(([, id]) => id);
    assert.ok(ids.includes(eligibleId));
    assert.ok(!ids.some(id => ['other-owner', 'related-only', 'needs-verification', 'requires-archived', 'requires-missing',
      'archived-blocked', 'no-longer-blocked', 'waiting-for-verification', 'ordinary-due'].includes(id)));
    assert.doesNotMatch(html, /FICTIONAL_PRIVATE|data-action="(?:resume-task|toggle-task)"|<form/);
    assert.deepEqual(f.state, before);
    f.ui.actor = 'no-assignment';
    assert.equal(f.html(), '');
    f.ui.actor = actor;
    f.window.GatherAccessLost = true;
    assert.equal(f.html(), '');
  }
});

test('personal and opted-in notification shortcuts open the exact task read-only and keep their focus return target', () => {
  for (const options of [{ view: 'overview' }, { view: 'tasks' }, { view: 'timeline', fromNotifications: true }]) {
    const f = fixture(options);
    f.state.tasks.push(task('same-title', { title }));
    const before = structuredClone(f.state);
    assert.equal(f.open(), true);
    assert.equal(f.calls.length, 1, 'no early focus before the dialog is mounted');
    const [kind, id, ...args] = f.calls[0];
    assert.equal(kind, 'task');
    assert.equal(id, eligibleId);
    assert.equal(args.at(-1).readOnly, true);
    assert.equal(f.ui.lastFocus, options.fromNotifications ? f.bell : f.opener);
    assert.equal(f.ui.linkedResultsReview?.id, eligibleId, 'the read-only review context survives redraw');
    f.flush();
    assert.equal(f.document.activeElement, f.dependencyHeading);
    assert.equal(f.state.tasks[0].status, 'blocked');
    assert.deepEqual(f.state, before);
  }
});

test('return focus finds the same result after redraw and falls back without focusing another task', () => {
  const f = fixture({ view: 'tasks' });
  const peer = f.control('same-title'), replacement = f.control();
  f.opener.isConnected = false;
  f.panel.append(peer, replacement);
  assert.equal(f.restore(), true);
  assert.equal(f.document.activeElement, replacement);
  replacement.isConnected = false;
  assert.equal(f.restore(), true);
  assert.equal(f.document.activeElement, f.panelHeading);
  f.root.children = [f.pageHeading];
  assert.equal(f.restore(), true);
  assert.equal(f.document.activeElement, f.pageHeading);
  assert.equal(f.pageHeading.tabIndex, -1);
});

test('stale, detached, opted-out, or no-longer-eligible controls cannot open a linked-results review', () => {
  const variants = {
    'out-of-view': f => { f.ui.view = 'budget'; },
    'actor scope': f => { f.panel.dataset.linkedResultsActor = 'other'; },
    'detached': f => { f.opener.isConnected = false; },
    'hidden': f => { f.panel.inert = true; },
    'wrong action': f => { f.opener.dataset.action = 'task'; },
    'wrong id': f => { f.opener.dataset.id = 'related-only'; },
    'outside real panel': f => { f.root.append(f.opener); },
    'access lost': f => { f.window.GatherAccessLost = true; },
    'save pending': f => { f.ui.pendingSave = true; },
    'pending refresh': f => { f.pending = true; },
    'newer revision': f => { f.stale = true; },
    'background tab': f => { f.document.hidden = true; },
    'reassignment': f => { f.state.tasks[0].owner = 'other'; },
    'prerequisite reopened': f => { f.state.tasks[1].status = 'todo'; },
    'already resumed': f => { f.state.tasks[0].status = 'progress'; },
  };
  for (const [label, invalidate] of Object.entries(variants)) {
    const f = fixture(); invalidate(f);
    assert.equal(f.open(), false, label);
    f.flush();
    assert.ok(!f.calls.some(([kind]) => kind === 'task' || kind === 'focus'), label);
  }
  for (const [optedIn, strongerCue] of [[false, false], [true, true]]) {
    const f = fixture({ fromNotifications: true, optedIn });
    if (strongerCue) f.state.tasks[0].completionReview = { note: 'PRIVATE' };
    assert.equal(f.open(), false);
    assert.ok(f.calls.some(([kind]) => kind === 'paint notifications'));
    assert.ok(!f.calls.some(([kind]) => kind === 'task'));
  }
});

test('queued linked-results focus cannot move into a newer dialog or steal existing focus', () => {
  const variants = {
    'replacement heading': f => f.replaceTitle(),
    'different task': f => { f.ui.detailId = 'related-only'; },
    'different view': f => { f.ui.view = 'tasks'; },
    'different project': f => { f.window.GatherMode.projectId = 'new-project'; },
    'moved focus': f => { f.document.activeElement = f.bell; },
    'pending update': f => { f.pending = true; },
    'prerequisite no longer verified': f => { f.state.tasks[1].verifiedAt = ''; },
  };
  for (const [label, invalidate] of Object.entries(variants)) {
    const f = fixture();
    assert.equal(f.open(), true, label);
    invalidate(f); f.flush();
    assert.ok(!f.calls.some(([kind]) => kind === 'focus'), label);
    assert.equal(f.state.tasks[0].status, 'blocked', label);
  }
});
