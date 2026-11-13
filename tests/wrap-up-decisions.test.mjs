import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/priorities.js';
import '../legacy/wrap-up.js';

const source = readFileSync('legacy/app.js', 'utf8');
const now = '2026-11-20T16:00:00Z';
const task = (id, patch = {}) => ({ id, title: id, owner: 'maya', status: 'todo', ...patch });
const returned = (id = 'returned', patch = {}) => task(id, { completionReview: { at: now, note: 'PRIVATE RETURN REASON' }, ...patch });
const amended = (id = 'amended', patch = {}) => task(id, { status: 'done', requiresVerification: true, verifiedAt: now,
  completionEvidence: { note: 'PRIVATE AMENDMENT TEXT' }, ...patch });
const workspace = (...tasks) => ({ tasks, members: [{ id: 'maya', name: 'Maya' }, { id: 'dev', name: 'Dev' }], event: { name: 'Fictional event' } });
const fragment = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
};

test('Wrap up adds scoped, read-only decision links without changing its three task groups', () => {
  const input = workspace(returned(), amended(), returned('awaiting', { requiresVerification: true, reportedAt: now }),
    amended('acknowledged', { completionEvidenceReviewAt: now }), returned('other returned', { owner: 'dev' }),
    amended('other amended', { owner: 'dev' }), returned('unowned', { owner: '' }), task('ordinary'));
  const before = structuredClone(input);
  const mine = { mine: true, actor: 'maya' };
  assert.deepEqual(GatherWrapUp.groups(input, mine).map(group => [group.key, group.tasks.map(row => row.id)]), [
    ['open', ['returned', 'ordinary']], ['verification', ['awaiting']], ['completed', ['amended', 'acknowledged']],
  ]);
  const decisions = html => [...html.matchAll(/<button\b[^>]*data-wrap-attention="(?:returned|amendment)"[^>]*>/g)].map(([tag]) => {
    assert.match(tag, /data-action="wrap-review-task"/);
    const field = name => tag.match(new RegExp(`data-${name}="([^"]+)"`))?.[1];
    assert.equal(field('wrap-review-kind'), field('wrap-attention'));
    return [field('id'), field('wrap-attention')];
  });
  const html = GatherWrapUp.markup(input, { scope: mine });
  assert.deepEqual(new Map(decisions(html)), new Map([['returned', 'returned'], ['amended', 'amendment']]));
  assert.equal(decisions(html).length, 2);
  assert.ok(html.indexOf('data-wrap-attention=') < html.indexOf('data-wrap-group='), 'decision links precede the ordinary groups');
  assert.doesNotMatch(html, /PRIVATE RETURN REASON|PRIVATE AMENDMENT TEXT|other returned|other amended|unowned|<form|data-action="(?:verify-task|review-completion-evidence|toggle-task)"/);
  assert.deepEqual(new Set(decisions(GatherWrapUp.markup(input, { scope: { actor: 'maya' } })).map(([id]) => id)),
    new Set(['returned', 'amended', 'other returned', 'other amended', 'unowned']));
  assert.equal(decisions(GatherWrapUp.markup(workspace(task('ordinary')), { scope: mine })).length, 0);
  assert.deepEqual(input, before);
});

test('returned shortcuts identify their purpose and do not imply that an unavailable owner can revise',()=>{
  const state=workspace(returned('missing',{owner:'missing'}),returned('inactive',{owner:'inactive'}),returned('mine'));
  state.members.push({id:'inactive',name:'Former teammate',active:false});
  for(const organizer of [false,true]){
    const html=GatherWrapUp.markup(state,{organizer,scope:{actor:'maya'}});
    assert.equal((html.match(organizer?/Assign an active owner to revise\./g:/Ask the organizer to assign an active owner\./g)||[]).length,2);
    assert.match(html,/Review requested changes before resubmitting/);
    for(const [,ids] of html.matchAll(/data-wrap-attention="returned" aria-describedby="([^"]+)"/g))
      for(const id of ids.split(' '))assert.ok(html.includes(`id="${id}"`));
    assert.equal((html.match(/data-wrap-attention="returned" aria-describedby=/g)||[]).length,3);
  }
});

function fixture() {
  let snapshot = workspace(returned()), organizer = false, title = {};
  const events = [], frames = [];
  const document = { activeElement: null }, window = { GatherMode: { projectId: 'fictional' } }, backdrop = { hidden: true };
  const ui = { actor: 'maya', wrapMine: false, view: 'memory', detailId: '', dialogKind: '' };
  const root = node('view'), dialog = node('dialog'), changes = node('changes heading');
  function node(name, dataset = {}, props = {}) {
    return { name, dataset, children: [], isConnected: true, open: false, ...props,
      append(...nodes) { for (const child of nodes) { child.parentElement = this; this.children.push(child); } return this; },
      contains(child) { for (let current = child; current; current = current.parentElement) if (current === this) return true; return false; },
      matches(selector) {
        if (selector === ':disabled') return !!this.disabled;
        if (selector === '[hidden],[inert]') return !!(this.hidden || this.inert);
        if (selector.startsWith('#')) return this.id === selector.slice(1);
        if (selector === 'summary') return this.name.endsWith('summary');
        const fields = [...selector.matchAll(/\[data-([a-z-]+)(?:="([^"]*)")?\]/g)];
        return fields.length > 0 && fields.every(([, name, value]) => {
          const key = name.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
          return value === undefined ? Object.hasOwn(this.dataset, key) : this.dataset[key] === value;
        });
      },
      closest(selector) { for (let current = this; current; current = current.parentElement) if (current.matches(selector)) return current; return null; },
      getClientRects() { return [{}]; },
      focus() { document.activeElement = this; events.push(['focus', this.name]); },
    };
  }
  const panel = () => node('wrap', { wrapReview: '', wrapActor: ui.actor, wrapScope: ui.wrapMine ? 'mine' : 'all' });
  const group = () => node('group', { wrapGroup: 'open' }).append(node('group summary'));
  const button = (name, id, decision = '', attention = '') => node(name,
    { action: 'wrap-review-task', id, wrapReviewKind: decision, ...(attention ? { wrapAttention: attention } : {}) });
  const $$ = (selector, parent = root) => parent.children.flatMap(function walk(child) { return [child, ...child.children.flatMap(walk)]; }).filter(el => el.matches(selector));
  const context = vm.createContext({ ui, window, document, GatherWrapUp, GatherPriorities, $$,
    $: (selector, parent = root) => ({ '#viewRoot': root, '#dialogBackdrop': backdrop, '#dialog': dialog, '#dialogTitle': title })[selector] ??
      (selector.includes('Completion changes requested') ? changes : $$(selector, parent)[0] ?? null),
    hiddenByClosedDisclosure: () => false, workspaceUpdatesPending: () => false,
    focusScheduleTarget: target => { target.focus(); return true; },
    focusTaskDialogControl: target => target?.focus(),
    requestAnimationFrame: callback => frames.push(callback), isOrganizer: () => organizer, store: { getState: () => snapshot },
    taskDialog(...args) { events.push(['task', ...args]); ui.detailId = args[0]; ui.dialogKind = 'task'; backdrop.hidden = false; },
    openOrganizerReview(...args) { events.push(['organizer review', ...args]); return false; },
    render() { events.push(['render']); }, toast: message => events.push(['toast', message]),
  });
  vm.runInContext(fragment('  function sameWrapReview(', '  function restoreViewFocus('), context);
  vm.runInContext(fragment('  function openWrapReviewTask(', '  function focusTaskDialogControl('), context);
  return { context, root, ui, window, events, panel, group, button,
    set snapshot(value) { snapshot = value; }, set organizer(value) { organizer = value; },
    replaceHeading() { title = {}; },
    mount(next) { root.children = []; root.append(next); },
    flush() { for (const frame of frames.splice(0)) frame(); },
  };
}

test('returning prefers the exact attention source and falls back to the same task’s ordinary group', () => {
  for (const sourceKind of ['returned', 'amendment', '']) {
    for (const survives of [true, false]) {
      const f = fixture();
      const old = f.button('old', 'task', sourceKind, sourceKind);
      f.panel().append(old); old.isConnected = false;
      const currentGroup = f.group().append(f.button('ordinary same task', 'task'), f.button('unrelated ordinary', 'other'));
      const differentKind = sourceKind === 'amendment' ? 'returned' : 'amendment';
      const panel = f.panel().append(f.button('different attention for same task', 'task', differentKind, differentKind),
        f.button('attention for other task', 'other', sourceKind || 'returned', sourceKind || 'returned'), currentGroup);
      if (survives && sourceKind) panel.append(f.button('exact attention source', 'task', sourceKind, sourceKind));
      f.mount(panel);
      assert.equal(f.context.restoreWrapReviewFocus(old, f.root), true);
      f.flush();
      const exact = survives && !!sourceKind;
      assert.deepEqual(f.events, [['focus', exact ? 'exact attention source' : 'ordinary same task']]);
      assert.equal(currentGroup.open, !exact);
    }
  }
});

test('a scheduled returned-decision focus cannot target a replacement task dialog or another actor', () => {
  for (const change of [f => f.replaceHeading(), f => { f.ui.detailId = 'other'; }, f => { f.ui.actor = 'dev'; },
    f => { f.window.GatherAccessLost = true; }, f => { f.window.GatherMode.projectId = 'other'; }]) {
    const f = fixture();
    const opener = f.button('returned opener', 'returned', 'returned', 'returned');
    f.mount(f.panel().append(opener));
    assert.equal(f.context.openWrapReviewTask('returned', opener), true);
    change(f);
    f.flush();
    assert.ok(f.events.every(([type]) => type !== 'focus'));
  }
});

test('the returned decision focuses requested changes only for an organizer or the current assigned owner', () => {
  for (const [actor, organizer, current, focused] of [
    ['maya', false, returned(), true], ['dev', true, returned(), true], ['dev', false, returned(), false],
    ['maya', false, task('returned'), false], ['maya', false, returned('returned', { reportedAt: now }), false],
  ]) {
    const f = fixture();
    f.ui.actor = actor; f.organizer = organizer; f.snapshot = workspace(current);
    const opener = f.button('returned opener', current.id, 'returned', 'returned');
    f.mount(f.panel().append(opener));
    assert.equal(f.context.openWrapReviewTask(current.id, opener), true);
    f.flush();
    assert.equal(f.ui.lastFocus, opener);
    assert.equal(f.events.filter(([kind]) => kind === 'task').length, 1);
    assert.ok(f.events.every(([kind]) => kind !== 'organizer review'));
    assert.deepEqual(f.events.filter(([kind]) => kind === 'focus'), focused ? [['focus', 'changes heading']] : []);
  }
});
