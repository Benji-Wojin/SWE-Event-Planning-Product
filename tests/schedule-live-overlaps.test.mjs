import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/priorities.js';
import '../legacy/schedule-ui.js';

const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const ui = GatherScheduleUI.create({ h, options: () => '', statusBadge: value => `<span>${h(value)}</span>` });
const zone = 'America/Los_Angeles';
const mine = { mine: true, actor: 'maya' };
const ownerOverlap = /\bOwner overlap\b/;
const locationOverlap = /\bPotential location overlap\b/;
const overlapIntent = markup => markup.match(/\bdata-open-schedule-overlap="([^"]+)"/)?.[1];
const activity = (id, start, end, location, owner = 'maya', patch = {}) => ({
  id, title: id, owner, status: 'todo', schedule: { start, end, location }, ...patch,
});
const state = tasks => ({ event: { timeZone: zone }, tasks, members: [{ id: 'maya', name: 'Maya' }, { id: 'dev', name: 'Dev' }] });
const buttons = (markup, id, className) => [...markup.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
  .map(([button]) => button).filter(button => {
    const opening = button.slice(0, button.indexOf('>'));
    return opening.includes(`data-id="${id}"`) && opening.match(/class="([^"]*)"/)?.[1].split(/\s+/).includes(className);
  });
const card = (markup, id) => buttons(markup, id, 'schedule-focus-task')[0] || '';
const source = readFileSync('legacy/app.js', 'utf8');
const fragment = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
};

test('current and next cards disclose scoped owner and cross-team location overlap without exposing other activity titles', () => {
  const date = '2026-10-03', at = time => `${date}T${time}`;
  const tasks = [
    activity('Current welcome', at('09:00'), at('09:40'), 'Fictional hall'),
    activity('Next briefing', at('09:30'), at('10:00'), 'Fictional hall'),
    activity('OUTSIDE MY ACTIVITIES', at('09:15'), at('10:15'), '  fictional  HALL ', 'dev'),
  ];
  const input = state(tasks), before = structuredClone(input);
  const now = '2026-10-03T16:20:00Z'; // 09:20 in Los Angeles
  for (const organizer of [true, false]) {
    const live = ui.clock(input, now, { ...mine, date }, organizer);
    assert.equal(live.labels.get('Current welcome'), 'Scheduled now');
    assert.equal(live.labels.get('Next briefing'), 'Next');
    for (const id of ['Current welcome', 'Next briefing']) {
      const shown = card(live.markup, id);
      assert.match(shown, /data-schedule-focus-day="2026-10-03"/);
      assert.match(shown, ownerOverlap);
      assert.match(shown, locationOverlap);
      assert.equal(overlapIntent(shown), 'both');
    }
    assert.doesNotMatch(live.markup, /OUTSIDE MY ACTIVITIES|data-action="(?:save|assign|toggle)/);
  }
  assert.deepEqual(input, before);
});

test('overnight live overlap follows the card’s event-local day, including continuation rows', () => {
  const input = state([
    activity('Overnight watch', '2026-10-03T23:00', '2026-10-04T01:00', 'Hall'),
    activity('Past-only clash', '2026-10-03T23:30', '2026-10-04T00:00', 'Hall'),
    activity('After midnight clash', '2026-10-04T00:30', '2026-10-04T01:15', 'Side room'),
    activity('OTHER DAY-OWNER TITLE', '2026-10-04T00:30', '2026-10-04T01:15', 'Hall', 'dev'),
  ]);
  const now = '2026-10-04T07:15:00Z'; // 00:15 next day in Los Angeles
  const live = ui.clock(input, now, { ...mine, date: '2026-10-04' });
  assert.equal(live.labels.get('Overnight watch'), 'Scheduled now');
  assert.equal(live.labels.get('After midnight clash'), 'Next');
  for (const id of ['Overnight watch', 'After midnight clash']) {
    const shown = card(live.markup, id);
    assert.match(shown, /data-schedule-focus-day="2026-10-04"/);
    assert.match(shown, ownerOverlap);
  }
  assert.match(card(live.markup, 'Overnight watch'), locationOverlap);
  assert.equal(overlapIntent(card(live.markup, 'Overnight watch')), 'both');
  assert.doesNotMatch(card(live.markup, 'After midnight clash'), locationOverlap);
  assert.equal(overlapIntent(card(live.markup, 'After midnight clash')), 'owner');
  assert.doesNotMatch(live.markup, /Past-only clash|OTHER DAY-OWNER TITLE/);
  assert.equal(ui.clock(input, now, { ...mine, date: '2026-10-03' }).markup, '');

  const onlyPast = state(input.tasks.slice(0, 2));
  assert.doesNotMatch(card(ui.clock(onlyPast, now, mine).markup, 'Overnight watch'), ownerOverlap);
  assert.doesNotMatch(card(ui.clock(onlyPast, now, mine).markup, 'Overnight watch'), locationOverlap);
  const followUp = ui.clock(onlyPast, '2026-10-04T08:15:00Z', mine);
  assert.equal(followUp.labels.get('Overnight watch'), 'Past scheduled end');
  const afterEnd = card(followUp.markup, 'Overnight watch');
  assert.match(afterEnd, /data-schedule-focus-day="2026-10-04"/);
  assert.doesNotMatch(afterEnd, ownerOverlap);
  assert.doesNotMatch(afterEnd, locationOverlap);
  assert.equal(overlapIntent(afterEnd), undefined);
  const prior = card(followUp.markup, 'Past-only clash');
  assert.match(prior, /data-schedule-focus-day="2026-10-03"/);
  assert.match(prior, ownerOverlap);
});

test('invalid wall times and resolved work cannot cause a live overlap, while pending verification still can', () => {
  const date = '2030-03-10', at = time => `${date}T${time}`;
  const now = '2030-03-10T09:45:00Z'; // 01:45 before the spring transition
  const current = activity('Valid crossing', at('01:15'), at('03:30'), 'Hall');
  const invalid = activity('Gap crossing', at('02:15'), at('03:15'), 'Hall');
  const resolved = activity('Verified work', at('01:20'), at('03:10'), 'Hall', 'maya', {
    status: 'done', requiresVerification: true, reportedAt: now, verifiedAt: now,
  });
  const pending = activity('Pending verification', at('01:20'), at('03:10'), 'Hall', 'maya', {
    status: 'progress', requiresVerification: true, reportedAt: now, verifiedAt: '',
  });
  const existing = state([current, invalid, resolved]), before = structuredClone(existing);
  const live = ui.clock(existing, now, mine, true);
  assert.ok(card(live.markup, current.id));
  assert.doesNotMatch(card(live.markup, current.id), ownerOverlap);
  assert.doesNotMatch(card(live.markup, current.id), locationOverlap);
  assert.equal(card(live.markup, invalid.id), '');
  assert.equal(card(live.markup, resolved.id), '');
  assert.deepEqual(existing, before);

  const withPending = ui.clock(state([...existing.tasks, pending]), now, mine, true).markup;
  assert.match(card(withPending, current.id), ownerOverlap);
  assert.match(card(withPending, current.id), locationOverlap);
  const pendingCard = card(withPending, pending.id);
  assert.match(pendingCard, /data-review-kind="completion"/);
  assert.match(pendingCard, ownerOverlap);
  assert.match(pendingCard, locationOverlap);
  assert.equal(overlapIntent(pendingCard), undefined);
  const teammate = card(ui.clock(state([current, pending]), now, mine, false).markup, pending.id);
  assert.match(teammate, /data-action="task"/);
  assert.match(teammate, /data-schedule-focus-kind="completion"/);
  assert.equal(overlapIntent(teammate), undefined);
});

test('dated Timeline rows carry only the overlap intent for the exact displayed day', () => {
  const input = state([
    activity('Overnight watch', '2026-10-03T23:00', '2026-10-04T01:00', 'Hall'),
    activity('Ends at midnight', '2026-10-03T23:30', '2026-10-04T00:00', 'Hall'),
    activity('Another team', '2026-10-04T00:30', '2026-10-04T01:15', 'Hall', 'dev'),
    activity('No clash', '2026-10-04T02:30', '2026-10-04T03:15', 'Hall'),
  ]);
  const markup = ui.view(input, false, '2026-10-04T07:15:00Z', mine);
  const overnight = buttons(markup, 'Overnight watch', 'schedule-row');
  assert.deepEqual(overnight.map(row => [row.match(/data-schedule-day="([^"]+)"/)?.[1], overlapIntent(row)]),
    [['2026-10-03', 'both'], ['2026-10-04', 'location']]);
  const [noClash] = buttons(markup, 'No clash', 'schedule-row');
  assert.ok(noClash);
  assert.equal(overlapIntent(noClash), undefined);
  assert.doesNotMatch(markup, /Another team/);
});

test('an overlap does not replace a pending recovery route on ordinary live and dated buttons', () => {
  const date = '2026-10-03', at = time => `${date}T${time}`, now = '2026-10-03T16:20:00Z';
  const help = activity('Activity needs help', at('09:00'), at('09:40'), 'Fictional hall', 'maya', {
    recoveryRequests: [{ kind: 'help', status: 'pending', note: 'INTERNAL REQUEST TEXT' }],
  });
  const other = activity('Another booking', at('09:30'), at('10:00'), 'Fictional hall');
  const input = state([help, other]);
  for (const organizer of [true, false]) {
    const markup = ui.view(input, organizer, now, { ...mine, date });
    const row = buttons(markup, help.id, 'schedule-row')[0];
    const live = card(markup, help.id);
    for (const button of [row, live]) {
      assert.match(button, /data-action="task"/);
      assert.match(button, /\bdata-open-recovery\b/);
      assert.match(button, ownerOverlap);
      assert.match(button, locationOverlap);
      assert.equal(overlapIntent(button), undefined);
    }
    assert.doesNotMatch(markup, /INTERNAL REQUEST TEXT/);
  }
});

test('click-time overlap classification requires a current matching date, owner scope and valid saved schedule', () => {
  const focus = activity('Overnight watch', '2026-10-03T23:00', '2026-10-04T01:00', 'Hall');
  const other = activity('Ends at midnight', '2026-10-03T23:30', '2026-10-04T00:00', 'Hall');
  const space = activity('Another team', '2026-10-04T00:30', '2026-10-04T01:15', 'Hall', 'dev');
  const input = state([focus, other, space]);
  const before = structuredClone(input);
  const classify = (day, scope = mine, current = input, id = focus.id) => GatherScheduleUI.overlapKindForDay(current, id, day, scope);
  assert.equal(classify('2026-10-03'), 'both');
  assert.equal(classify('2026-10-04'), 'location');
  assert.equal(classify('2026-10-04', { ...mine, date: '2026-10-03' }), '');
  for (const day of ['', '2026-02-30', '2026-10-02', '2026-10-05']) assert.equal(classify(day), '', day);
  assert.equal(classify('2026-10-04', { ...mine, actor: 'dev' }), '');
  assert.equal(classify('2026-10-04', mine, input, 'missing'), '');
  const moved = { ...space, schedule: { ...space.schedule, start: '2026-10-04T01:00' } };
  assert.equal(classify('2026-10-04', mine, state([focus, other, moved])), '', 'the former overlap no longer exists at click time');
  assert.equal(classify('2026-10-04', mine, state([{ ...focus, status: 'done' }, other, space])), '', 'resolved work does not reopen an overlap');
  const gap = activity('Nonexistent start', '2030-03-10T02:15', '2030-03-10T03:30', 'Hall');
  const valid = activity('Valid shift', '2030-03-10T01:30', '2030-03-10T03:15', 'Hall');
  assert.equal(classify('2030-03-10', mine, state([gap, valid]), gap.id), '', 'an invalid saved endpoint is not a current conflict');
  assert.deepEqual(input, before);
});

test('task details give owner and location overlap separate disclosure targets without widening edit access', () => {
  const time = value => `2026-10-03T${value}`;
  const focus = activity('Fictional setup', time('09:00'), time('10:00'), 'Hall');
  const own = activity('Other owner commitment', time('09:30'), time('10:30'), 'Side room');
  const space = activity('Other use of hall', time('09:30'), time('10:30'), 'Hall', 'dev');
  const { event, tasks } = state([focus, own, space]);
  for (const organizer of [true, false]) {
    const details = ui.details(focus, organizer, event, tasks);
    const disclosures = new Map([...details.matchAll(/<details\b[^>]*data-schedule-overlap-kind="([^"]+)"[^>]*>([\s\S]*?)<\/details>/g)]
      .map(([, kind, content]) => [kind, content]));
    assert.deepEqual([...disclosures.keys()], ['owner', 'location']);
    assert.match(disclosures.get('owner'), /<summary id="scheduleOwnerOverlapSummary">Owner overlap · 1 activity<\/summary>.*Other owner commitment/s);
    assert.doesNotMatch(disclosures.get('owner'), /Other use of hall/);
    assert.match(disclosures.get('location'), /<summary id="scheduleLocationOverlapSummary">Potential location overlap · 1 activity<\/summary>.*Other use of hall/s);
    assert.doesNotMatch(disclosures.get('location'), /Other owner commitment/);
    assert.equal(/id="scheduleForm"/.test(details), organizer);
    for (const list of disclosures.values()) assert.equal(/data-action="review-overlap-schedule"/.test(list), organizer);
    assert.equal(/data-action="review-task-owner"/.test(disclosures.get('owner')), organizer);
    assert.doesNotMatch(disclosures.get('location'), /data-action="review-task-owner"/);
    if (organizer) {
      assert.match(disclosures.get('owner'), />Review activity time<\/button>/);
      assert.match(disclosures.get('location'), />Review time or location<\/button>/);
    }
  }
  const reported = { ...focus, requiresVerification: true, reportedAt: '2026-10-03T16:20:00Z' };
  const pending = ui.details(reported, true, event, [reported, own, space]);
  assert.match(pending, /data-action="review-overlap-schedule"/);
  assert.doesNotMatch(pending, /data-action="review-task-owner"/);
});

test('overlap details prioritize peers on the originating Timeline date without hiding other dates', () => {
  const selected = '2026-10-04';
  const focus = activity('Overnight watch', '2026-10-03T23:00', '2026-10-04T01:00', 'Hall');
  const prior = activity('Saturday overlap', '2026-10-03T23:30', '2026-10-04T00:00', 'Hall');
  const later = activity('Sunday overlap', '2026-10-04T00:30', '2026-10-04T01:15', 'Hall');
  const { event, tasks } = state([focus, prior, later]);
  const disclosureRows = details => [...details.matchAll(/<details\b[^>]*data-schedule-overlap-kind="[^"]+"[^>]*>([\s\S]*?)<\/details>/g)]
    .map(([, section]) => [...section.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(([, row]) => row));
  const details = ui.details(focus, true, event, tasks, selected);
  assert.ok(details.includes(`Timeline date: <strong>${GatherScheduleUI.dateLabel(selected)}</strong>. Overlaps on this date are listed first.`));
  assert.equal((details.match(/aria-describedby="scheduleOverlapContext"[^>]*>[^<]+ · 1 on this date · 2 total/g) || []).length, 2);
  const selectedRows = disclosureRows(details);
  assert.equal(selectedRows.length, 2);
  for (const [first, second] of selectedRows) {
    assert.match(first, /Sunday overlap/);
    assert.doesNotMatch(first, /Overlap on another day/);
    assert.match(second, /Saturday overlap.*Overlap on another day/s);
  }
  const normal = ui.details(focus, true, event, tasks);
  assert.doesNotMatch(normal, /Timeline date:|Overlap on another day/);
  for (const [first, second] of disclosureRows(normal)) {
    assert.match(first, /Saturday overlap/);
    assert.match(second, /Sunday overlap/);
  }
  assert.match(ui.details(focus, true, event, [focus, prior], selected), /No current overlap on this date\./);
});

test('a stale overlap opener can narrow to the original conflict kinds but cannot redirect to a different review', () => {
  const date = '2026-10-03', at = time => `${date}T${time}`;
  const activityUnderReview = activity('Setup', at('09:00'), at('10:00'), 'Hall', 'maya', { requiresVerification: true });
  const roomOnly = activity('Other hall use', at('09:30'), at('10:30'), 'Hall', 'dev');
  const ownerOnly = activity('Another commitment', at('09:30'), at('10:30'), 'Side room');
  const backdrop = { hidden: true };
  const request = new Set();
  const opener = {
    isConnected: true, dataset: { id: activityUnderReview.id, action: 'task', scheduleDay: date, openScheduleOverlap: 'both' },
    hasAttribute: key => request.has(key),
  };
  let current = state([activityUnderReview, roomOnly]);
  const context = vm.createContext({
    GatherScheduleUI, GatherPriorities, window: {},
    ui: { view: 'timeline', timelineMode: 'schedule', scheduleMine: true, actor: 'maya', scheduleDate: date },
    store: { getState: () => current }, $: () => backdrop, isScheduleControl: element => element === opener,
    completionNeedsReview: task => task.requiresVerification, // Ordinary open work can still require future verification.
  });
  vm.runInContext(fragment('  function timelineOverlapIntent(', '  function focusTaskOverlap('), context);
  const read = () => context.timelineOverlapIntent(opener, opener.dataset.id);
  assert.equal(read(), 'location', 'the original both warning narrows to its current surviving location conflict');
  opener.dataset.openScheduleOverlap = 'owner';
  assert.equal(read(), '', 'an old owner-only warning cannot redirect to an unrelated location conflict');
  current = state([activityUnderReview, ownerOnly, roomOnly]);
  assert.equal(read(), 'owner', 'a newly added conflict kind does not widen the original requested destination');
  current = state([{ ...activityUnderReview, reportedAt: '2026-10-03T16:20:00Z' }, ownerOnly, roomOnly]);
  assert.equal(read(), '', 'an actual pending completion report remains higher priority');
  current = state([activityUnderReview, ownerOnly]);
  for (const key of ['data-open-recovery', 'data-open-recovery-reply']) {
    request.add(key);
    assert.equal(read(), '');
    request.delete(key);
  }
  opener.dataset.scheduleFocusKind = 'completion';
  assert.equal(read(), '');
  delete opener.dataset.scheduleFocusKind;
  context.ui.scheduleDate = '2026-10-04';
  assert.equal(read(), '');
  context.ui.scheduleDate = date;
  backdrop.hidden = false;
  assert.equal(read(), '');
});

test('opening a valid overlap reveals only the matching task disclosure and never focuses a replacement dialog', () => {
  const frames = [], focuses = [], dialog = {}, backdrop = { hidden: false };
  let title = {};
  const owner = { dataset: { scheduleOverlapKind: 'owner' }, summary: {} };
  const location = { dataset: { scheduleOverlapKind: 'location' }, summary: {} };
  const context = vm.createContext({
    window: { GatherMode: { projectId: 'fictional' } }, ui: { actor: 'maya', dialogKind: 'task', detailId: 'activity' },
    requestAnimationFrame: callback => frames.push(callback),
    $(selector, root) {
      return ({ '#dialog': dialog, '#dialogTitle': title, '#dialogBackdrop': backdrop, summary: root?.summary })[selector];
    },
    $$: () => [owner, location], focusTaskDialogControl: (target, root) => focuses.push([target, root]),
  });
  vm.runInContext(fragment('  function focusTaskOverlap(', '  function openReturnedCompletion('), context);
  const focus = kind => context.focusTaskOverlap('activity', kind);
  const flush = () => frames.shift()();
  focus('location');
  flush();
  assert.equal(owner.open, undefined);
  assert.equal(location.open, true);
  assert.deepEqual(focuses.splice(0), [[location.summary, dialog]]);
  focus('both');
  flush();
  assert.equal(owner.open, true);
  assert.deepEqual(focuses.splice(0), [[owner.summary, dialog]]);
  for (const replace of [() => { title = {}; }, () => { backdrop.hidden = true; }, () => { context.window.GatherMode.projectId = 'other'; }]) {
    focus('owner');
    replace();
    flush();
    assert.deepEqual(focuses, []);
    backdrop.hidden = false;
    context.window.GatherMode.projectId = 'fictional';
  }
});
