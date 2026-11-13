import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../legacy/wrap-up.js';

const task = (id, title, extra = {}) => ({ id, title, owner: 'maya', status: 'todo', ...extra });
const mine = { mine: true, actor: 'maya' };
const rowsFor = tasks => GatherWrapUp.reusableTitles({ tasks }, mine, { withIdentity: true });

test('checklist choices follow stable identities in new source order and retain unfinished title edits', () => {
  const previous = rowsFor([
    task('entrance', 'Check\nmain entrance'),
    task('supplies-one', 'Pack supplies'),
    task('supplies-two', 'Pack supplies'),
  ]);
  const next = rowsFor([
    task('supplies-two', 'Pack supplies'),
    task('new', 'Review venue'),
    task('entrance', 'Check\tmain entrance'),
    task('supplies-one', 'Pack supplies'),
  ]);
  const choices = [
    { index: 1, title: 'Pack the welcome supplies' },
    { index: 0, title: '' },
    { index: 2, title: ' Pack ' },
  ];
  const before = structuredClone({ previous, next, choices });

  assert.deepEqual(GatherWrapUp.reconcileReusableChoices(previous, next, choices), {
    choices: [
      { index: 0, title: ' Pack ' },
      { index: 2, title: '' },
      { index: 3, title: 'Pack the welcome supplies' },
    ],
    cleared: 0,
  });
  assert.deepEqual({ previous, next, choices }, before);
});

test('refresh clears choices for missing, renamed, reclassified, and out-of-scope tasks without selecting substitutes', () => {
  const tasks = [
    task('removed', 'Same task title'),
    task('renamed', 'Old task title'),
    task('regrouped', 'Needs review'),
    task('reassigned', 'Review signs'),
    task('retained', 'Keep this work'),
    task('unselected', 'Do not select me'),
  ];
  const previous = rowsFor(tasks);
  const next = rowsFor([
    task('replacement', 'Same task title'),
    task('renamed', 'New task title'),
    task('regrouped', 'Needs review', { requiresVerification: true, reportedAt: '2030-01-01T00:00Z' }),
    task('reassigned', 'Review signs', { owner: 'dev' }),
    task('unselected', 'Do not select me'),
    task('retained', 'Keep this work'),
  ]);

  const result = GatherWrapUp.reconcileReusableChoices(previous, next,
    previous.slice(0, 5).map((_, index) => ({ index, title: 'An edited title' })));
  assert.deepEqual(result, { choices: [{ index: 3, title: 'An edited title' }], cleared: 4 });
  assert.equal(next[result.choices[0].index].id, 'retained');
});

test('missing or ambiguous task identities never carry a selection across a refresh', () => {
  const previous = rowsFor([
    task('prior-duplicate', 'First prior row'),
    task('prior-duplicate', 'Second prior row'),
    task('next-duplicate', 'A title to keep separate'),
    task('', 'No stable identity'),
  ]);
  const next = rowsFor([
    task('prior-duplicate', 'First prior row'),
    task('next-duplicate', 'A title to keep separate'),
    task('next-duplicate', 'Other title, same next ID'),
    task('', 'No stable identity'),
  ]);

  assert.deepEqual(GatherWrapUp.reconcileReusableChoices(previous, next, [
    { index: 0, title: 'First prior edit' },
    { index: 2, title: 'Second prior edit' },
    { index: 3, title: 'Third prior edit' },
  ]), { choices: [], cleared: 3 });
});

test('opt-in row identity does not change ordinary title rows or leak into the picker and clipboard', () => {
  const state = { tasks: [
    task('fictional-internal-id', 'Check\nentrance', { note: 'FICTIONAL_PRIVATE_NOTE', dueDate: '2030-01-01' }),
    task('other-scope-id', 'Outside personal scope', { owner: 'dev' }),
  ] };
  const plain = GatherWrapUp.reusableTitles(state, mine);
  const internal = GatherWrapUp.reusableTitles(state, mine, { withIdentity: true });
  assert.deepEqual(plain, [{ title: 'Check entrance', group: 'Still open' }]);
  assert.deepEqual(internal, [{ ...plain[0], id: 'fictional-internal-id' }]);
  assert.equal(GatherWrapUp.reusablePicker(internal, { mine: true }), GatherWrapUp.reusablePicker(plain, { mine: true }));
  assert.doesNotMatch(GatherWrapUp.reusablePicker(internal), /internal-id|PRIVATE_NOTE|2030-01-01|other-scope-id/);
  assert.equal(GatherWrapUp.reusableChecklist(internal, [{ index: 0, title: internal[0].title }]), '- [ ] Check entrance');
});
