import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../legacy/calendar.js';
import '../legacy/schedule-ui.js';

const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const ui = GatherScheduleUI.create({ h, options: () => '', statusBadge: value => `<span>${h(value)}</span>` });
const zone = 'America/Los_Angeles';
const mine = { mine: true, actor: 'maya' };
const ownerOverlap = /\bOwner overlap\b/;
const locationOverlap = /\bPotential location overlap\b/;
const activity = (id, start, end, location, owner = 'maya', patch = {}) => ({
  id, title: id, owner, status: 'todo', schedule: { start, end, location }, ...patch,
});
const state = tasks => ({ event: { timeZone: zone }, tasks, members: [{ id: 'maya', name: 'Maya' }, { id: 'dev', name: 'Dev' }] });
const card = (markup, id) => [...markup.matchAll(/<button\b[^>]*class="[^"]*\bschedule-focus-task\b[^"]*"[^>]*>[\s\S]*?<\/button>/g)]
  .map(([button]) => button).find(button => button.slice(0, button.indexOf('>')).includes(`data-id="${id}"`)) || '';

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
  assert.doesNotMatch(card(live.markup, 'After midnight clash'), locationOverlap);
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
});
