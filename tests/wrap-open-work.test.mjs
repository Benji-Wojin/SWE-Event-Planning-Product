import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../legacy/wrap-up.js';

const now = '2030-10-04T16:00:00Z';
const task = (id, fields = {}) => ({ id, title: id, owner: 'maya', status: 'todo', ...fields });
const required = taskId => ({ taskId, kind: 'dependency', reason: 'FICTIONAL_LINK_PRIVATE' });
const blocked = (id, dependencies, fields = {}) => task(id, { status: 'blocked', dependencies, ...fields });
const workspace = (...tasks) => ({ tasks, members: [
  { id: 'maya', name: 'Maya', role: 'Organizer' },
  { id: 'dev', name: 'Dev', role: 'Teammate' },
  { id: 'old', name: 'Former teammate', active: false },
  { id: 'example', name: 'Example teammate', role: 'Teammate · example' },
] });

test('open work flags one current reason per task, using recorded required completion and live owners', () => {
  const input = workspace(
    task('plain-done', { status: 'done' }),
    task('verified-done', { status: 'done', requiresVerification: true, verifiedAt: now, note: 'FICTIONAL_PREDECESSOR_PRIVATE' }),
    task('unverified', { status: 'done', requiresVerification: true }),
    task('in-progress'),
    task('unassigned', { owner: '' }),
    task('missing-owner', { owner: 'not-a-member' }),
    task('inactive-owner', { owner: 'old' }),
    task('example-owner', { owner: 'example' }),
    blocked('blocked-unassigned', [required('plain-done')], { owner: '' }),
    blocked('required-done', [required('plain-done'), required('verified-done'), { taskId: 'missing-related', kind: 'related' }]),
    blocked('example-ready', [required('plain-done')], { owner: 'example' }),
    blocked('required-missing', [required('missing-required')]),
    blocked('required-unverified', [required('plain-done'), required('unverified')]),
    blocked('required-open', [required('in-progress')]),
    blocked('related-only', [{ taskId: 'plain-done', kind: 'related' }]),
    blocked('no-required-work', []),
    task('not-blocked', { dependencies: [required('plain-done')] }),
    blocked('returned', [required('plain-done')], { owner: '', completionReview: { at: now } }),
    blocked('reported', [required('plain-done')], { owner: '', reportedAt: now, requiresVerification: true }),
    blocked('already-verified', [required('plain-done')], { owner: '', verifiedAt: now }),
    blocked('archived', [required('plain-done')], { owner: '', archivedAt: now }),
    task('unassigned-done', { owner: '', status: 'done' }),
  );
  const before = structuredClone(input);
  const live = GatherWrapUp.openWorkKinds(input);
  assert.ok(live instanceof Map);
  assert.deepEqual(live, new Map([
    ['unassigned', 'owner-gap'], ['missing-owner', 'owner-gap'], ['inactive-owner', 'owner-gap'],
    ['example-owner', 'owner-gap'], ['blocked-unassigned', 'owner-gap'],
    ['required-done', 'linked-results'], ['example-ready', 'owner-gap'],
  ]));
  const demo = new Map(live);
  demo.delete('example-owner');
  demo.set('example-ready', 'linked-results');
  assert.deepEqual(GatherWrapUp.openWorkKinds(input, { demo: true }), demo);
  assert.deepEqual(input, before);
});

function shortcuts(html) {
  return [...html.matchAll(/<button\b[^>]*\bdata-wrap-attention="(?:owner-gap|linked-results)"[^>]*>/g)].map(([tag]) => {
    const attr = key => tag.match(new RegExp(`\\b${key}="([^"]*)"`))?.[1];
    assert.equal(attr('data-action'), 'wrap-review-task');
    assert.equal(attr('data-wrap-attention'), attr('data-wrap-review-kind'));
    return [attr('data-id'), attr('data-wrap-attention')];
  });
}

test('Wrap up scopes open-work shortcuts but evaluates required work in the full project', () => {
  const input = workspace(
    task('other-completed', { owner: 'dev', status: 'done', note: 'FICTIONAL_PREDECESSOR_PRIVATE' }),
    task('unassigned', { owner: '' }),
    blocked('mine-ready', [required('other-completed')]),
    blocked('other-ready', [required('other-completed')], { owner: 'dev' }),
    task('mine-report', { requiresVerification: true, reportedAt: now, completionEvidence: { note: 'FICTIONAL_EVIDENCE_PRIVATE' } }),
    task('mine-done', { status: 'done' }),
  );
  const before = structuredClone(input);
  const mine = GatherWrapUp.markup(input, { scope: { mine: true, actor: 'maya' } });
  assert.match(mine, /Open work needs attention/);
  assert.deepEqual(shortcuts(mine), [['mine-ready', 'linked-results']]);
  assert.doesNotMatch(mine, /other-completed|other-ready|data-id="unassigned"/);
  assert.match(mine, /<dt>Still open<\/dt><dd>1<\/dd>.*<dt>Completion to verify<\/dt><dd>1<\/dd>.*<dt>Recorded completions<\/dt><dd>1<\/dd>/);
  assert.match(mine, /3 tasks in this review/);
  const all = GatherWrapUp.markup(input, { organizer: true, scope: { actor: 'maya' } });
  const expected = new Map([['unassigned', 'owner-gap'], ['mine-ready', 'linked-results'], ['other-ready', 'linked-results']]);
  assert.deepEqual(new Map(shortcuts(all)), expected);
  assert.equal(shortcuts(all).length, expected.size);
  assert.match(all, /<dt>Still open<\/dt><dd>3<\/dd>.*<dt>Completion to verify<\/dt><dd>1<\/dd>.*<dt>Recorded completions<\/dt><dd>2<\/dd>/);
  assert.match(all, /6 tasks in this review/);
  for (const html of [mine, all]) {
    assert.doesNotMatch(html, /FICTIONAL_(?:LINK|PREDECESSOR|EVIDENCE)_PRIVATE|<form|data-action="(?:toggle-task|verify-task|resume-task)"/);
    assert.ok(html.indexOf('Open work needs attention') < html.indexOf('data-wrap-group='));
  }
  assert.doesNotMatch(GatherWrapUp.markup(workspace(task('ordinary'))), /Open work needs attention/);
  assert.deepEqual(input, before);
});
