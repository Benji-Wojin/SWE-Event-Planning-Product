import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/wrap-up.js';

const source = readFileSync('legacy/app.js', 'utf8');
const now = '2026-11-20T16:00:00Z';
const row = (id, patch = {}) => ({ id, title: id, owner: 'maya', status: 'todo', ...patch });
const input = (...tasks) => ({ event: { name: 'Fictional rehearsal' }, members: [{ id: 'maya', name: 'Maya' }, { id: 'dev', name: 'Dev' }], tasks });
const button = (html, id) => [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0]).find(tag => tag.includes(`data-id="${id}"`));
const kind = tag => tag?.match(/data-wrap-review-kind="([^"]*)"/)?.[1] || '';
const fragment = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
};

test('Wrap up marks exact completion or amendment review hints and preserves My tasks scope', () => {
  const state = input(
    row('open'),
    row('report', { status: 'progress', requiresVerification: true, reportedAt: now, completionEvidence: { note: 'PRIVATE FIXTURE' } }),
    row('legacy', { status: 'done', requiresVerification: true }),
    row('amended', { status: 'done', requiresVerification: true, verifiedAt: now, completionEvidence: { note: 'PRIVATE FIXTURE' } }),
    row('acknowledged', { status: 'done', requiresVerification: true, verifiedAt: now, completionEvidence: { note: 'PRIVATE FIXTURE' }, completionEvidenceReviewAt: now }),
    row('outside', { owner: 'dev', status: 'progress', requiresVerification: true, reportedAt: now }),
    row('unassigned', { owner: '' }),
  );
  const before = structuredClone(state);
  {
    const html = GatherWrapUp.markup(state, { scope: { mine: true, actor: 'maya' } });
    assert.match(html, /\bdata-wrap-review\b/);
    assert.match(html, /data-wrap-actor="maya"/);
    assert.match(html, /data-wrap-scope="mine"/);
    for (const id of ['open', 'report', 'legacy', 'amended', 'acknowledged']) assert.match(button(html, id) ?? '', /data-action="wrap-review-task"/);
    assert.equal(kind(button(html, 'report')), 'completion');
    assert.equal(kind(button(html, 'amended')), 'amendment');
    for (const id of ['open', 'legacy', 'acknowledged']) assert.equal(kind(button(html, id)), '', id);
    assert.equal(button(html, 'outside'), undefined);
    assert.equal(button(html, 'unassigned'), undefined);
    assert.doesNotMatch(html, /PRIVATE FIXTURE|<form|data-action="(?:verify-task|review-completion-evidence|toggle-task)"/);
    assert.deepEqual([...html.matchAll(/<details\b[^>]*data-wrap-group="([^"]+)"[^>]*data-wrap-default="([^"]+)"[^>]*>/g)]
      .map(([, group, open]) => [group, open]), [['open', 'open'], ['verification', 'open'], ['completed', 'closed']]);
  }
  assert.deepEqual(state, before);
});

function fixture() {
  let snapshot = input(row('report', { status: 'progress', requiresVerification: true, reportedAt: now }));
  let organizer = true;
  const calls = [], frames = [];
  const document = { body: {}, activeElement: null }, window = {};
  const ui = { view: 'memory', actor: 'maya', wrapMine: true, detailId: '', dialogKind: '' };
  const root = node('view', {}), backdrop = { hidden: true };
  function node(name, dataset = {}, extra = {}) {
    return { name, dataset, children: [], isConnected: true, open: false, hidden: false, inert: false, ...extra,
      append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } return this; },
      contains(child) { for (let current = child; current; current = current.parentElement) if (current === this) return true; return false; },
      matches(selector) {
        if (selector === ':disabled') return !!this.disabled;
        if (selector === '[hidden],[inert]') return this.hidden || this.inert;
        if (selector.startsWith('#')) return this.id === selector.slice(1);
        if (selector === 'summary') return this.tagName === 'SUMMARY';
        const key = selector.match(/^\[data-([a-z-]+)(?:="([^"]*)")?\]$/);
        if (key) {
          const property = key[1].replace(/-([a-z])/g, (_, char) => char.toUpperCase());
          return key[2] === undefined ? Object.hasOwn(this.dataset, property) : this.dataset[property] === key[2];
        }
        return false;
      },
      closest(selector) { for (let current = this; current; current = current.parentElement) if (current.matches(selector)) return current; return null; },
      getAttribute(key) { return key === 'aria-pressed' ? String(this.pressed) : null; },
      getClientRects() { return this.hidden ? [] : [{}]; },
      getBoundingClientRect() { return { top: 120, bottom: 155 }; },
      focus() { document.activeElement = this; calls.push(['focus', this.name]); },
      scrollIntoView() { calls.push(['scroll', this.name]); },
      querySelector(selector) { return query(selector, this)[0] ?? null; },
    };
  }
  function query(selector, from = root) {
    const all = from.children.flatMap(function walk(child) { return [child, ...child.children.flatMap(walk)]; });
    if (selector.includes('[aria-pressed="true"]')) return all.filter(el => el.pressed && el.matches(selector.replace('[aria-pressed="true"]', '')));
    return all.filter(el => el.matches(selector));
  }
  const panel = (actor = 'maya', scope = 'mine') => node('review', { wrapReview: '', wrapActor: actor, wrapScope: scope });
  const group = (key, open = false, normal = 'closed') => node(`${key} group`, { wrapGroup: key, wrapDefault: normal }, { open, tagName: 'DETAILS' }).append(node(`${key} summary`, {}, { tagName: 'SUMMARY' }));
  const reviewTask = (id, reviewKind = '') => node(`row ${id}`, { id, action: 'wrap-review-task', wrapReviewKind: reviewKind }, { tagName: 'BUTTON' });
  const scopeButton = () => node('selected scope', { action: 'wrap-up-scope', id: 'mine' }, { pressed: true });
  const heading = () => node('review heading', {}, { id: 'wrapUpReviewHeading', tagName: 'H2' });
  const context = vm.createContext({ ui, document, window, GatherWrapUp,
    $: (selector, from = root) => selector === '#viewRoot' ? root : selector === '#dialogBackdrop' ? backdrop : query(selector, from)[0] ?? null,
    $$: query, requestAnimationFrame: callback => frames.push(callback),
    isOrganizer: () => organizer, store: { getState: () => snapshot },
    taskDialog(...args) { calls.push(['task', ...args]); ui.detailId = args[0]; ui.dialogKind = 'task'; backdrop.hidden = false; },
    openOrganizerReview(...args) {
      const [id, kind] = args, current = snapshot.tasks.find(task => task.id === id);
      const matched = kind === 'completion' && current?.requiresVerification && current.reportedAt && !current.verifiedAt ||
        kind === 'amendment' && current?.status === 'done' && current.verifiedAt && current.completionEvidence && current.completionEvidenceReviewAt !== current.verifiedAt;
      if (!matched) return false;
      calls.push(['review', ...args]); ui.detailId = id; ui.dialogKind = 'task'; backdrop.hidden = false; return true;
    },
    focusable: node => query('[data-action]', node), hiddenByClosedDisclosure: () => false,
    focusScheduleTarget: node => { node.focus(); return true; },
    toast: message => calls.push(['toast', message]), render: () => calls.push(['render']),
  });
  vm.runInContext(fragment('  function sameWrapReview(', '  function restoreViewFocus('), context);
  vm.runInContext(fragment('  function openWrapReviewTask(', '  function focusTaskRecovery('), context);
  return { root, ui, document, window, backdrop, calls, context, panel, group, reviewTask, scopeButton, heading,
    set snapshot(value) { snapshot = value; }, set organizer(value) { organizer = value; },
    mount(value) { root.children = []; root.append(value); return value; },
    flush() { for (const frame of frames.splice(0)) frame(); },
  };
}

test('Wrap up restores the exact task after it moves into a closed group, without selecting a different task', () => {
  const f = fixture(), old = f.reviewTask('report', 'completion');
  f.panel().append(f.group('verification', true, 'open').append(old));
  old.isConnected = false;
  const other = f.reviewTask('unrelated'), current = f.reviewTask('report');
  const completed = f.group('completed').append(current);
  f.mount(f.panel().append(f.group('verification', true, 'open').append(other), completed, f.heading()));
  assert.equal(f.context.restoreWrapReviewFocus(old, f.root), true);
  f.flush();
  assert.equal(completed.open, true);
  assert.deepEqual(f.calls.filter(([kind]) => kind === 'focus'), [['focus', 'row report']]);
});

test('when the original task no longer belongs to the review, focus falls back to its prior group, then scope or heading', () => {
  const f = fixture(), old = f.reviewTask('report', 'completion');
  f.panel().append(f.group('verification', true, 'open').append(old));
  old.isConnected = false;
  const unrelated = f.reviewTask('unrelated');
  for (const [available, name] of [['group', 'verification summary'], ['scope', 'selected scope'], ['heading', 'review heading']]) {
    const next = f.panel().append(f.group('completed').append(unrelated), f.heading());
    if (available !== 'heading') next.append(f.scopeButton());
    if (available === 'group') next.append(f.group('verification'));
    f.mount(next);
    f.calls.length = 0;
    assert.equal(f.context.restoreWrapReviewFocus(old, f.root), true);
    f.flush();
    assert.deepEqual(f.calls.filter(([kind]) => kind === 'focus'), [['focus', name]]);
  }
  for (const next of [f.panel('dev'), f.panel('maya', 'all')]) {
    f.mount(next.append(f.reviewTask('report'), f.heading()));
    f.calls.length = 0;
    assert.equal(f.context.restoreWrapReviewFocus(old, f.root), false);
    f.flush();
    assert.deepEqual(f.calls, []);
  }
});

test('only explicit disclosure choices are preserved, and only in the same Wrap up scope', () => {
  const f = fixture();
  const old = f.panel().append(f.group('open', true, 'open'), f.group('verification', false, 'open'), f.group('completed', true));
  const overrides = f.context.wrapReviewOverrides(old);
  assert.deepEqual(Array.from(overrides, pair => [...pair]), [['verification', false], ['completed', true]]);
  const groups = [f.group('open', false), f.group('verification', true, 'open'), f.group('completed', false)];
  f.mount(f.panel().append(...groups));
  f.context.restoreWrapReviewDisclosures(old, overrides, f.root);
  assert.deepEqual(groups.map(group => group.open), [false, false, true], 'the unchanged default follows the fresh model');
  const other = [f.group('verification', true, 'open'), f.group('completed', false)];
  f.mount(f.panel('maya', 'all').append(...other));
  f.context.restoreWrapReviewDisclosures(old, overrides, f.root);
  assert.deepEqual(other.map(group => group.open), [true, false]);
});

test('opening Wrap up reuses the current organizer review and falls back to ordinary task details for teammates or resolved reviews', () => {
  for (const [organizer, reported, expected] of [[true, true, 'review'], [false, true, 'task'], [true, false, 'task']]) {
    const f = fixture();
    f.organizer = organizer;
    f.snapshot = input(row('report', { status: reported ? 'progress' : 'done', requiresVerification: true, ...(reported ? { reportedAt: now } : { verifiedAt: now }) }));
    const opener = f.reviewTask('report', 'completion');
    f.mount(f.panel().append(f.group('verification', true, 'open').append(opener)));
    f.context.openWrapReviewTask('report', opener);
    f.flush();
    const actions = f.calls.filter(([type]) => type === 'task' || type === 'review');
    assert.equal(actions.length, 1);
    assert.deepEqual(actions[0].slice(0, expected === 'review' ? 3 : 2), expected === 'review' ? ['review', 'report', 'completion'] : ['task', 'report']);
    assert.equal(f.ui.lastFocus, opener);
  }
  const f = fixture(), opener = f.reviewTask('report', 'amendment');
  f.snapshot = input(row('report', { status: 'done', requiresVerification: true, verifiedAt: now, completionEvidence: { note: 'Fictional amendment' } }));
  f.mount(f.panel().append(f.group('completed', true).append(opener)));
  assert.equal(f.context.openWrapReviewTask('report', opener), true);
  assert.deepEqual(f.calls[0].slice(0, 3), ['review', 'report', 'amendment']);
});

test('Wrap up cannot open an activity from another scope or after project access is lost', () => {
  for (const change of [f => { f.window.GatherAccessLost = true; }, f => { f.ui.view = 'tasks'; },
    f => { f.ui.actor = 'dev'; }, f => { f.ui.wrapMine = false; }, f => { f.snapshot = input(row('report', { owner: 'dev' })); }]) {
    const f = fixture(), opener = f.reviewTask('report', 'completion');
    f.mount(f.panel().append(f.group('verification', true, 'open').append(opener)));
    change(f);
    f.context.openWrapReviewTask('report', opener);
    assert.ok(f.calls.every(([type]) => type !== 'task' && type !== 'review'));
  }
});
