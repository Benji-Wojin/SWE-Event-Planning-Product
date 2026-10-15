import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({
  entryPoints: ['lib/plan-selection.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { planSelection } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(bundle.outputFiles[0].text).toString('base64')
);
const item = {
  id: 'one',
  title: 'Confirm venue',
  start: '',
  dependsOn: [],
  included: false,
};
const dependent = {
  id: 'two',
  title: 'Prepare arrival',
  start: '',
  dependsOn: ['one'],
  included: true,
};
test('unique exact matches can satisfy an excluded prerequisite, without fuzzy title or date matches', () => {
  const existing = [{ id: 'old', title: ' CONFIRM venue! ', start: '' }];
  const resolved = planSelection([item, dependent], existing);
  assert.equal(resolved.reusable.get('one'), 'old');
  assert.equal(resolved.missing.length, 0);
  for (const patch of [
    { title: 'Confirm venue and AV' },
    { start: '2030-10-05T09:00' },
  ]) {
    const result = planSelection(
      [item, dependent],
      [{ ...existing[0], ...patch }],
    );
    assert.equal(result.reusable.size, 0);
    assert.equal(result.missing.length, 1);
  }
});
test('ambiguous existing matches never choose a task silently', () => {
  const result = planSelection(
    [item, dependent],
    [
      { ...item, id: 'old' },
      { ...item, id: 'other' },
    ],
  );
  assert.equal(result.reusable.size, 0);
  assert.equal(result.missing.length, 1);
});
test('selected duplicates are rejected both within the draft and against existing tasks', () => {
  const selected = { ...item, included: true };
  assert.deepEqual(
    [...planSelection([selected], [{ ...item, id: 'old' }]).duplicates],
    ['one'],
  );
  assert.deepEqual(
    [...planSelection([selected, { ...selected, id: 'other' }], []).duplicates],
    ['other'],
  );
  assert.equal(
    planSelection(
      [selected, { ...selected, id: 'other', start: '2030-10-05T09:00' }],
      [],
    ).duplicates.size,
    0,
  );
});
