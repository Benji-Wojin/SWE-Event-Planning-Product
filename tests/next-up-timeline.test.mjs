import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/priorities.js';
import '../legacy/schedule-ui.js';
import '../legacy/recovery-ui.js';

const source = readFileSync('legacy/app.js', 'utf8');
const actor = 'fictional-teammate', activityId = 'fictional-overnight';
const day = '2099-11-20', carryover = '2099-11-21', priorDay = '2099-11-19';
const slot = { start: `${day}T23:45`, end: `${carryover}T01:15`, location: 'West gate' };
const committed = '2026-11-01T20:00:00Z';
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const task = (id, extra = {}) => ({ id, title: id, owner: actor, status: 'todo', dueDate: priorDay, dependencies: [], ...extra });
const state = tasks => ({ tasks, event: { timeZone: 'America/Los_Angeles' }, members: [], demoGeneration: 1 });

function fragment(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}

test('the Timeline target uses the saved event-local start day, never prep, end or browser date', () => {
  const target = GatherScheduleUI.personalTimelineDay;
  assert.equal(target(task(activityId, { schedule: slot }), actor), day);
  assert.equal(target(task('repeated', { schedule: { start: '2026-11-01T01:30', end: '2026-11-01T02:00' } }), actor), '2026-11-01',
    'a legacy wall-time warning is still discoverable on its dated Timeline row');
  for (const other of [null, task('other', { owner: 'different', schedule: slot }),
    task('archived', { archivedAt: committed, schedule: slot }), task('untimed', { eventActivity: true }),
    task('invalid-day', { schedule: { start: '2099-02-29T08:00' } }),
    task('invalid-clock', { schedule: { start: `${day}T24:20` } }),
    task('with-zone', { schedule: { start: `${day}T16:30Z` } }),
    task('no-clock', { schedule: { start: day } }),
  ]) assert.ok(!target(other, actor), other?.id);
  assert.ok(!target(task('unowned', { owner: '', schedule: slot }), ''));
});

const taskRow = (html, id) => [...html.matchAll(/<article>[\s\S]*?<\/article>/g)].map(([row]) => row)
  .find(row => row.includes(`data-id="${id}"`)) || '';

test('both personal panels offer a secondary action only for scheduled rows and keep existing review actions', () => {
  const s = state([
    task(activityId, { title: 'Check <West & East>', nextUpAt: committed, schedule: slot }),
    task('untimed', { nextUpAt: committed, eventActivity: true }),
    task('waiting', { schedule: slot, recoveryRequests: [{ kind: 'help', status: 'pending', createdBy: actor, note: 'Fictional private request' }] }),
    task('returned', { schedule: slot, completionReview: { note: 'Fictional private evidence' } }),
    task('suggested', { schedule: slot }),
    task('reaccept', { schedule: slot, scheduleReconfirmation: { owner: actor, previous: null, timeZone: 'America/Los_Angeles' } }),
    task('removed-slot', { eventActivity: true, scheduleReconfirmation: { owner: actor, previous: slot, timeZone: 'America/Los_Angeles' } }),
    task('someone-else', { owner: 'different', schedule: slot, nextUpAt: committed }),
  ]);
  const before = structuredClone(s);
  const recovery = GatherRecoveryUI.create({ store: { getState: () => s }, ui: { actor }, h, options: () => '', dayLabel: h, member: id => ({ name: id }) });
  for (const overview of [false, true]) {
    const html = recovery.nextUpPanel(s, { overview });
    assert.match(html, new RegExp(`data-next-up-panel="${overview ? 'overview' : 'mine'}"`));
    for (const id of [activityId, 'waiting', 'returned', 'suggested', 'reaccept']) {
      const row = taskRow(html, id);
      const buttons = [...row.matchAll(/<button[^>]*data-action="next-up-timeline"[^>]*>Show in Timeline<\/button>/g)];
      assert.equal(buttons.length, 1, id);
      assert.match(buttons[0][0], /data-next-up-origin="timeline"/);
      assert.ok(buttons[0][0].includes(`data-id="${id}"`));
    }
    assert.match(taskRow(html, activityId), /aria-label="Show in Timeline: Check &lt;West &amp; East&gt;"/);
    assert.match(taskRow(html, 'waiting'), /data-open-recovery/);
    assert.match(taskRow(html, 'returned'), /data-action="review-returned-completion"/);
    assert.match(taskRow(html, 'reaccept'), /data-action="review-schedule-reconfirmation"/);
    assert.match(taskRow(html, 'removed-slot'), /data-action="review-schedule-reconfirmation"/);
    assert.doesNotMatch(taskRow(html, 'untimed') + taskRow(html, 'removed-slot'), /data-action="next-up-timeline"/);
    assert.doesNotMatch(html, /someone-else|Fictional private|<form|data-action="(?:claim|accept-task|toggle-task)"/);
  }
  assert.deepEqual(s, before);
});

function route({ overview = false } = {}) {
  const s = state([task(activityId, { title: 'Same activity name', schedule: slot })]);
  const ui = { actor, view: overview ? 'overview' : 'tasks', tab: 'mine', timelineMode: 'deadlines', scheduleDate: priorDay, scheduleMine: true };
  const window = { GatherMode: { projectId: 'fictional-project' }, GatherAccessLost: false };
  const document = { hidden: false };
  const root = {}, backdrop = { hidden: true }, calls = [], frames = [];
  let blocked = false, knownStale = false, denied = false, closedDisclosure = false;
  const opener = { isConnected: true, dataset: { action: 'next-up-timeline', nextUpOrigin: 'timeline', id: activityId } };
  const panel = { dataset: { nextUpPanel: overview ? 'overview' : 'mine', nextUpActor: actor }, contains: button => button === opener, closest: () => null };
  opener.closest = selector => selector === '[data-next-up-panel]' ? panel : null;
  opener.matches = () => false;
  const heading = { id: 'schedulePanelHeading' };
  const row = (label, id, scheduleDay, extra = {}) => ({ label, isConnected: true, dataset: { action: 'task', id, scheduleDay },
    matches: () => false, closest: () => null, getClientRects: () => [{}], ...extra });
  const exact = row('exact', activityId, day);
  const rows = [row('same title', 'unrelated', day), row('carryover', activityId, carryover), exact];
  const store = { getState: () => s, getSnapshotRevision: () => 12,
    refresh() { assert.fail('Navigation must not read the server'); }, addTask() { assert.fail('Navigation must not write'); } };
  const context = vm.createContext({ ui, window, document, store, GatherScheduleUI,
    $: selector => ({ '#dialogBackdrop': backdrop, '#viewRoot': root, '#schedulePanelHeading': heading })[selector] ?? null,
    $$: (selector, container) => selector.includes('schedule-row') && container === root ? rows : [],
    currentNextUpPanel: candidate => candidate === root ? panel : null,
    workspaceUpdatesPending: () => blocked, scheduleRevisionIsStale: () => knownStale,
    hiddenByClosedDisclosure: () => closedDisclosure, focusable: () => rows,
    navigate(view, options) {
      calls.push(['navigate', view, options?.scheduleDay]);
      if (denied) return false;
      ui.view = view; ui.timelineMode = 'schedule'; ui.scheduleDate = options.scheduleDay;
      return true;
    },
    focusScheduleTarget(target) { if (!target) return false; calls.push(['focus', target]); return true; },
    toast: message => calls.push(['toast', message]), render: () => calls.push(['render']),
    requestAnimationFrame: callback => frames.push(callback),
  });
  vm.runInContext(fragment('  function jumpFromNextUpToTimeline(', '  function openScheduleReconfirmation('), context);
  return { s, ui, window, document, backdrop, opener, panel, heading, calls, rows, exact,
    set blocked(value) { blocked = value; }, set knownStale(value) { knownStale = value; },
    set denied(value) { denied = value; }, set closedDisclosure(value) { closedDisclosure = value; },
    jump: (id = activityId, button = opener) => context.jumpFromNextUpToTimeline(id, button),
    flush() { for (const frame of frames.splice(0)) frame(); },
  };
}

test('the shortcut keeps scope and focuses only the exact dated row rather than a carryover or same-name peer', () => {
  for (const overview of [false, true]) {
    const f = route({ overview }), before = structuredClone(f.s);
    f.ui.scheduleMine = !overview;
    assert.equal(f.jump(), true);
    f.flush();
    assert.deepEqual(f.calls, [['navigate', 'timeline', day], ['focus', f.exact]]);
    assert.equal(f.ui.timelineMode, 'schedule');
    assert.equal(f.ui.scheduleDate, day);
    assert.equal(f.ui.scheduleMine, !overview);
    assert.deepEqual(f.s, before);
  }
});

test('stale, unavailable and fake routes never change the date or open an activity', () => {
  const variants = {
    'wrong action': f => { f.opener.dataset.action = 'task'; }, 'wrong origin': f => { f.opener.dataset.nextUpOrigin = 'task'; },
    'detached': f => { f.opener.isConnected = false; }, 'not in panel': f => { f.panel.contains = () => false; },
    'hidden': f => { f.opener.closest = () => ({}); }, 'closed suggestion list': f => { f.closedDisclosure = true; },
    'actor': f => { f.panel.dataset.nextUpActor = 'different'; }, 'panel': f => { f.panel.dataset.nextUpPanel = 'overview'; },
    'view': f => { f.ui.view = 'budget'; }, 'tab': f => { f.ui.tab = 'all'; }, 'modal': f => { f.backdrop.hidden = false; },
    'save': f => { f.ui.pendingSave = true; }, 'access': f => { f.window.GatherAccessLost = true; },
    'reassigned': f => { f.s.tasks[0].owner = 'different'; }, 'removed': f => { f.s.tasks = []; },
    'unscheduled': f => { delete f.s.tasks[0].schedule; }, 'archived': f => { f.s.tasks[0].archivedAt = committed; },
    'stale banner': f => { f.blocked = true; }, 'newer revision': f => { f.knownStale = true; },
  };
  for (const [label, mutate] of Object.entries(variants)) {
    const f = route(); mutate(f);
    assert.equal(f.jump(), false, label);
    f.flush();
    assert.ok(!f.calls.some(([name]) => name === 'navigate' || name === 'focus'), label);
    assert.equal(f.ui.scheduleDate, priorDay, label);
    assert.equal(f.ui.timelineMode, 'deadlines', label);
  }
  const f = route();
  assert.equal(f.jump('unrelated'), false);
  assert.deepEqual(f.calls, []);
});

test('a missing exact row focuses the schedule heading, but denied navigation leaves the old controls alone', () => {
  const missing = route();
  missing.rows.pop();
  missing.jump(); missing.flush();
  assert.deepEqual(missing.calls.filter(([name]) => name === 'focus'), [['focus', missing.heading]]);
  assert.match(missing.calls.find(([name]) => name === 'toast')?.[1] ?? '', /no longer visible on this date/i);
  const denied = route();
  denied.denied = true;
  assert.equal(denied.jump(), false);
  denied.flush();
  assert.deepEqual(denied.calls, [['navigate', 'timeline', day]]);
  assert.equal(denied.ui.view, 'tasks');
  assert.equal(denied.ui.scheduleDate, priorDay);
  assert.equal(denied.ui.timelineMode, 'deadlines');
});

test('navigation applies the date and URL only after the existing sidebar and save guards agree', () => {
  const ui = { view: 'overview', timelineMode: 'deadlines', scheduleDate: priorDay, scheduleMine: true };
  const calls = [];
  let allowed = false;
  const context = vm.createContext({ ui, labels: { overview: 'Overview', timeline: 'Timeline' },
    planSidebar: { canLeave: () => allowed }, privateEpoch: 0, guideViewReady: '', taskLinkUnavailable: false,
    navigation: { replace: value => calls.push(['view', value]), replaceScheduleDate: value => calls.push(['day', value]) },
    setDrawer() {}, render: () => calls.push(['render', ui.view, ui.scheduleDate]), window: { scrollTo() {} },
  });
  vm.runInContext(fragment('  function navigate(', '  function confirmTaskOwnerChange('), context);
  const go = () => context.navigate('timeline', { scheduleDay: day });
  assert.equal(go(), false);
  assert.deepEqual(calls.splice(0), [['view', 'overview']]);
  assert.equal(ui.timelineMode, 'deadlines');
  assert.equal(ui.scheduleDate, priorDay);
  ui.pendingSave = true;
  allowed = true;
  assert.equal(go(), false);
  assert.deepEqual(calls.splice(0), [['view', 'overview']]);
  ui.pendingSave = false;
  assert.equal(go(), true);
  assert.deepEqual(calls, [['day', day], ['view', 'timeline'], ['render', 'timeline', day]]);
  assert.equal(ui.timelineMode, 'schedule');
  assert.equal(ui.scheduleMine, true);
});
