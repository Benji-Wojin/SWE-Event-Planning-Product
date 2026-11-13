import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/schedule-ui.js';
import '../legacy/planning-ui.js';

const app = readFileSync(new URL('../legacy/app.js', import.meta.url), 'utf8');
const verified = '2026-11-18T20:00:00Z', sourceId = 'verified-source';
const title = 'Fictional <West & East> handoff';
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const link = (taskId = sourceId, kind = 'dependency') => ({ taskId, kind, reason: 'FICTIONAL_PRIVATE_LINK_REASON' });
const row = (id, fields = {}) => ({ id, title: id, owner: 'maya', status: 'todo', dependencies: [],
  note: 'FICTIONAL_PRIVATE_NOTE', completionEvidence: { note: 'FICTIONAL_PRIVATE_EVIDENCE' },
  completionResult: { text: 'FICTIONAL_PRIVATE_RESULT' }, ...fields });

function sourceBlock(from, to) {
  const start = app.indexOf(from), end = app.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, from);
  return app.slice(start, end);
}

function fixture() {
  const source = row(sourceId, { status: 'done', requiresVerification: true, verifiedAt: verified });
  const ready = row('ready-target', { title, status: 'blocked', dependencies: [link(), link('unverified', 'related')] });
  const waiting = row('waiting-target', { title, status: 'progress', dependencies: [link(), link('unverified')] });
  const state = { members: [{ id: 'maya', name: 'Fictional teammate' }], tasks: [
    source, ready, waiting,
    row('missing-target', { dependencies: [link(), link('missing-prerequisite')] }),
    row('archived-prerequisite-target', { dependencies: [link(), link('archived-prerequisite')] }),
    row('unverified', { status: 'done', requiresVerification: true }),
    row('archived-prerequisite', { status: 'done', archivedAt: verified }),
    row('related-target', { dependencies: [link(sourceId, 'related')] }),
    row('archived-target', { archivedAt: verified, dependencies: [link()] }),
    row('done-target', { status: 'done', dependencies: [link()] }),
    row('awaiting-review-target', { status: 'done', requiresVerification: true, dependencies: [link()] }),
    row('transitive-target', { dependencies: [link(ready.id)] }),
    row('unrelated-target'),
  ] };
  const window = { GatherAccessLost: false }, ui = { actor: 'jack', dialogKind: 'task', detailId: source.id };
  let organizer = true, pending = false, stale = false, closedDisclosure = false;
  const calls = [], backdrop = { hidden: false }, dialog = {}, mounted = new Set();
  const section = { contains: opener => mounted.has(opener) };
  const heading = { closest: selector => selector === 'section' ? section : null };
  function control(id, { mount = true } = {}) {
    const opener = { dataset: { action: 'task', id }, isConnected: true, hidden: false,
      hasAttribute: name => name === 'data-completion-linked-target',
      closest: selector => selector === '[hidden],[inert]' && opener.hidden ? {} : null };
    if (mount) mounted.add(opener);
    return opener;
  }
  const context = vm.createContext({ window, ui, h, GatherScheduleUI, GatherPlanningUI,
    store: { getState: () => state, getSnapshotRevision: () => 9,
      refresh() { assert.fail('Opening a required task should not fetch data.'); },
      resumeTask() { assert.fail('Opening a required task should not resume it.'); },
      verifyTask() { assert.fail('Opening a required task should not verify it.'); },
    }, isOrganizer: () => organizer, icon: () => '',
    canCreateTasks: () => false, member: () => ({ name: 'Fictional teammate' }),
    options: () => '', relationshipCard: () => '', linkedTaskForm: () => '',
    statuses: { todo: 'To do', progress: 'In progress', done: 'Done', blocked: 'Blocked' },
    $: (selector, parent) => ({ '#dialog': dialog, '#dialogBackdrop': backdrop,
      '#completionLinkedImpactHeading': parent === dialog ? heading : null })[selector] ?? null,
    workspaceUpdatesPending: () => pending,
    scheduleRevisionIsStale: revision => { assert.equal(revision, 9); return stale; },
    hiddenByClosedDisclosure: () => closedDisclosure,
    toast: message => calls.push(['toast', message]), taskDialog: (...args) => calls.push(['task', ...args]),
  });
  vm.runInContext(sourceBlock('  function dependencyInfo(', '  function linkedTaskForm(') +
    sourceBlock('  function completionLinkedImpact(', '  function relationshipCard('), context);
  return { source, state, ready, waiting, window, ui, backdrop, calls, control, set organizer(value) { organizer = value; },
    set pending(value) { pending = value; }, set stale(value) { stale = value; },
    set closedDisclosure(value) { closedDisclosure = value; },
    impact(task = source) {
      const dependents = state.tasks.filter(item => item.dependencies.some(dependency => dependency.taskId === task.id));
      return context.completionLinkedImpact(task, state, dependents);
    },
    relationships: (task = source) => context.dependencyMarkup(task),
    open: (id, opener) => context.openCompletionLinkedTarget(id, opener),
  };
}

const actions = markup => [...markup.matchAll(/data-action="task"(?: data-completion-linked-target)? data-id="([^"]+)"/g)].map(([, id]) => id);

test('completion impact groups only exact direct Required tasks and reports remaining work without changing anything', () => {
  const f = fixture(), before = structuredClone(f.state);
  const { markup, shownIds } = f.impact();
  assert.match(markup, /id="completionLinkedImpactHeading" tabindex="-1">Required by/);
  assert.match(markup, /doesn’t resume a blocked task or verify a completion report/);
  const [complete, waiting] = markup.split('<h4>Still waiting on required work · 3</h4>');
  assert.match(complete, /Required work complete · 2/);
  assert.deepEqual(actions(complete), ['ready-target', 'awaiting-review-target']);
  assert.match(complete, /Still marked Blocked/);
  assert.match(complete, /Awaiting organizer verification/);
  assert.deepEqual(actions(waiting), ['waiting-target', 'missing-target', 'archived-prerequisite-target']);
  assert.equal((waiting.match(/1 required task remains/g) ?? []).length, 3);
  assert.deepEqual([...shownIds].sort(), [...actions(markup)].sort());
  assert.equal((markup.match(/Fictional &lt;West &amp; East&gt; handoff/g) ?? []).length, 2, 'duplicate titles keep independent exact task controls');
  assert.doesNotMatch(markup, /FICTIONAL_PRIVATE|related-target|done-target|archived-target|transitive-target|unrelated-target|<form/);
  assert.deepEqual(f.state, before);
});

test('the impact hides for unresolved or archived sources, no current dependents, and non-organizers', () => {
  const cases = {
    'unverified source': f => { delete f.source.verifiedAt; },
    'reopened source': f => { f.source.status = 'progress'; },
    'archived source': f => { f.source.archivedAt = verified; },
    'no direct Required dependents': f => { f.state.tasks = f.state.tasks.filter(task => !task.dependencies.some(link => link.taskId === sourceId && link.kind !== 'related')); },
    'non-organizer': f => { f.organizer = false; f.ui.actor = 'maya'; },
    'access lost': f => { f.window.GatherAccessLost = true; },
  };
  for (const [name, invalidate] of Object.entries(cases)) {
    const f = fixture(); invalidate(f);
    const { markup, shownIds } = f.impact();
    assert.equal(markup, '', name);
    assert.equal(shownIds.size, 0, name);
  }
});

test('relationship rendering does not duplicate impact controls or erase the separate general links', () => {
  const f = fixture(), html = f.relationships();
  const [impact, general] = html.split('<h3>Linked from</h3>');
  assert.ok(general);
  assert.deepEqual(actions(impact), ['ready-target', 'awaiting-review-target', 'waiting-target', 'missing-target', 'archived-prerequisite-target']);
  assert.ok(actions(general).includes('related-target'));
  assert.ok(actions(general).includes('done-target'));
  assert.ok(actions(general).every(id => !actions(impact).includes(id)));
  f.organizer = false;
  assert.doesNotMatch(f.relationships(), /completionLinkedImpactHeading/);
  assert.ok(actions(f.relationships()).includes('ready-target'), 'normal relationships remain available to the teammate');
});

test('grouped controls open only the exact current required task and do so read-only', () => {
  const f = fixture(), before = structuredClone(f.state);
  f.control(f.ready.id);
  const selected = f.control(f.waiting.id);
  f.open(f.waiting.id, selected);
  assert.equal(f.ready.title, f.waiting.title, 'duplicate titles cannot determine which task opens');
  assert.equal(f.calls.length, 1);
  const [action, id, ...args] = f.calls[0];
  assert.equal(action, 'task');
  assert.equal(id, f.waiting.id);
  assert.equal(args.at(-1).readOnly, true);
  assert.deepEqual(f.state, before);
});

test('stale snapshots, ineligible tasks, and hidden or foreign impact controls cannot navigate', () => {
  for (const [label, alter] of Object.entries({
    'stale revision': f => { f.stale = true; },
    'updates pending': f => { f.pending = true; },
    'reopened source': f => { f.source.status = 'progress'; },
    'removed source': f => { f.state.tasks.shift(); },
    'now Related': f => { f.waiting.dependencies[0].kind = 'related'; },
    'now complete': f => { f.waiting.status = 'done'; },
    'now archived': f => { f.waiting.archivedAt = verified; },
    'not organizer': f => { f.organizer = false; },
    'lost access': f => { f.window.GatherAccessLost = true; },
    'hidden backdrop': f => { f.backdrop.hidden = true; },
    'different dialog': f => { f.ui.dialogKind = 'notifications'; },
    'closed disclosure': f => { f.closedDisclosure = true; },
    'detached control': (_f, opener) => { opener.isConnected = false; },
    'hidden control': (_f, opener) => { opener.hidden = true; },
    'wrong action': (_f, opener) => { opener.dataset.action = 'resume-task'; },
    'wrong target ID': (f, opener) => { opener.dataset.id = f.ready.id; },
    'missing impact marker': (_f, opener) => { opener.hasAttribute = () => false; },
    'foreign section': f => f.control(f.waiting.id, { mount: false }),
  })) {
    const f = fixture(), mounted = f.control(f.waiting.id);
    const opener = alter(f, mounted) || mounted;
    const before = structuredClone(f.state);
    f.open(f.waiting.id, opener);
    assert.ok(f.calls.every(([action]) => action === 'toast'), label);
    assert.deepEqual(f.state, before, label);
    if (label === 'stale revision' || label === 'updates pending') assert.match(f.calls[0]?.[1], /Refresh the project/, label);
  }
});
