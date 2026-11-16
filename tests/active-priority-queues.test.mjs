import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../legacy/calendar.js';
import '../legacy/priorities.js';
import '../legacy/recovery-ui.js';

const at = '2026-11-16T12:00:00Z';
const now = new Date(at);
const zone = 'UTC';
const owner = 'maya';
const task = (id, extra = {}) => ({
  id, title: id, owner, status: 'todo', dueDate: '', updatedAt: at,
  acceptedAt: at, dependencies: [], ...extra,
});
const archived = (id, extra) => task(id, { ...extra, archivedAt: at });
const request = (kind) => ({
  kind, status: 'pending', createdAt: at, createdBy: owner, note: 'Fictional private request',
});
const required = (taskId) => ({ taskId, kind: 'dependency' });
const fixture = (tasks) => {
  const state = { tasks, event: { timeZone: zone }, members: [{ id: owner, name: 'Maya Example' }] };
  const recovery = GatherRecoveryUI.create({
    store: { getState: () => state }, ui: { actor: owner }, h: (value) => String(value),
    options: () => '', dayLabel: (value) => String(value), member: () => state.members[0],
  });
  return { state, recovery };
};
const ids = (tasks) => tasks.map((row) => row.id);

test('an archive-only project has no attention, Next up, workload, or organizer-review entries', () => {
  const tasks = [
    archived('Archived high priority', { priority: 'high', nextUpAt: at }),
    archived('Archived returned completion', { completionReview: { note: 'Fictional return' } }),
    archived('Archived help request', { recoveryRequests: [request('help')] }),
    archived('Archived date proposal', { recoveryRequests: [request('date')] }),
    archived('Archived pending verification', { requiresVerification: true, reportedAt: at }),
    archived('Archived amended evidence', {
      status: 'done', verifiedAt: at, completionEvidence: { at: '2026-11-17T12:00:00Z' },
    }),
  ];
  const before = structuredClone(tasks);
  const { state, recovery } = fixture(tasks);
  const priority = GatherPriorities;
  for (const row of tasks) {
    assert.equal(priority.analyze(row, tasks, now, zone), null, row.id);
    assert.equal(priority.decision(row, tasks, now, zone), null, row.id);
  }
  assert.deepEqual(priority.rank(tasks, now, false, zone), []);
  assert.deepEqual(priority.rank(tasks, now, true, zone), []);
  assert.deepEqual(priority.nextUp(tasks, owner, now, zone), []);
  assert.deepEqual(priority.personalNextUp(tasks, owner, now, zone), {
    active: [], returned: [], suggested: [], hasOwned: false,
  });
  assert.deepEqual(GatherRecoveryUI.organizerReviews(tasks), []);
  assert.equal(recovery.organizerReviewPanel(state), '');
  assert.match(recovery.ownerLoad(owner), /0\/3 next tasks · 0 other assignments/);
  for (const overview of [false, true]) {
    const html = recovery.nextUpPanel(state, { overview });
    assert.match(html, /No open tasks assigned to you/);
    assert.doesNotMatch(html, /Archived |Completion changes requested|Waiting for the organizer|Suggested next tasks/);
  }
  assert.deepEqual(tasks, before, 'queue reads leave saved archive and evidence facts untouched');
});

test('live requests and returned work still route while a verified archived prerequisite stays unavailable', () => {
  const target = archived('Archived verified prerequisite', { status: 'done', requiresVerification: true, verifiedAt: at });
  const completion = task('Review active handover', { requiresVerification: true, reportedAt: at, dependencies: [required(target.id)] });
  const dependent = task('Active setup', { dependencies: [required(target.id)] });
  const help = task('Active help request', { recoveryRequests: [request('help')] });
  const returned = task('Active returned completion', { status: 'blocked', completionReview: { note: 'Fictional return' } });
  const commitment = task('Active commitment', { nextUpAt: at });
  const tasks = [target, completion, dependent, help, returned, commitment,
    archived('Archived lingering request', { recoveryRequests: [request('date')] }),
    archived('Archived lingering return', { completionReview: { note: 'Fictional return' } }),
  ];
  const { state, recovery } = fixture(tasks);
  const before = structuredClone(tasks);
  const priority = GatherPriorities;
  assert.deepEqual(priority.unresolved(dependent, tasks), [required(target.id)]);
  assert.equal(priority.actionable(dependent, tasks), false);
  assert.equal(priority.decision(dependent, tasks, now, zone)?.key, 'missing');
  assert.ok(priority.analyze(dependent, tasks, now, zone).factors.some((factor) => factor.key === 'required-unavailable'));
  const personal = priority.personalNextUp(tasks, owner, now, zone);
  assert.deepEqual(ids(personal.active), [commitment.id]);
  assert.deepEqual(ids(personal.returned), [returned.id]);
  assert.ok(!ids(personal.suggested).includes(dependent.id));
  const reviews = GatherRecoveryUI.organizerReviews(tasks);
  assert.deepEqual(reviews.map((row) => row.kind).sort(), ['completion', 'help']);
  assert.equal(reviews.find((row) => row.task.id === completion.id)?.waitingOnRequiredWork, true);
  const review = recovery.organizerReviewPanel(state);
  assert.match(review, /Review required work: Review active handover/);
  assert.match(review, /Respond to help request: Active help request/);
  assert.doesNotMatch(review, /Archived |Fictional private request/);
  for (const overview of [false, true]) {
    const html = recovery.nextUpPanel(state, { overview });
    assert.match(html, /Waiting for the organizer[\s\S]*Active help request/);
    assert.match(html, /Completion changes requested[\s\S]*Active returned completion/);
    assert.match(html, /Active commitment/);
    assert.doesNotMatch(html, /Archived |Fictional private request|Active setup/);
  }
  assert.match(recovery.ownerLoad(owner), /1\/3 next tasks · 4 other assignments/);
  assert.deepEqual(tasks, before);
});

test('archived dependents cannot inflate active prerequisite priority or relay an urgent deadline', () => {
  const priority = GatherPriorities;
  const base = task('Active prerequisite');
  const urgent = task('Urgent work', {
    hardDeadline: true, essential: true, dueDate: '2026-11-16', dependencies: [required('Intermediate work')],
  });
  const bridge = task('Intermediate work', { dependencies: [required(base.id)] });
  const openChain = [base, bridge, urgent];
  const archivedChain = [base, { ...bridge, archivedAt: at }, urgent];
  assert.deepEqual(ids(priority.downstream(base, openChain)), [bridge.id, urgent.id]);
  assert.equal(priority.rank(openChain, now, false, zone)[0]?.id, base.id);
  assert.deepEqual(priority.downstream(base, archivedChain), []);
  assert.equal(priority.analyze(base, archivedChain, now, zone), priority.analyze(base, [base], now, zone));
  assert.deepEqual(ids(priority.rank(archivedChain, now, false, zone)), [urgent.id]);
});
