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
const { planSelection, duplicateSuggestions } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(bundle.outputFiles[0].text).toString('base64')
);
const item = {
  id: 'one',
  title: 'Confirm venue',
  kind: 'preparation',
  note: '',
  location: '',
  dueDate: '',
  end: '',
  category: 'Venue',
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
test('semantic suggestions require a human choice before reusing an existing task', () => {
  const paraphrase = { ...item, title: 'Secure venue booking', included: true, existingTaskIndex: 0 };
  const existing = [{ id: 'old', title: 'Book the venue', start: '' }];
  const suggestions = duplicateSuggestions([paraphrase], existing);
  assert.equal(suggestions.length, 1);
  assert.equal(planSelection([{ ...paraphrase, title: paraphrase.title + ' ', note: ' ', location: ' ' }], existing, suggestions).unresolved.size, 1);
  let result = planSelection([paraphrase, dependent], existing, suggestions);
  assert.equal(result.unresolved.has('one'), true);
  assert.equal(result.reusable.size, 0);
  result = planSelection([{ ...paraphrase, included: false, duplicateChoice: 'reuse' }, dependent], existing, suggestions);
  assert.equal(result.reusable.get('one'), 'old');
  assert.equal(result.missing.length, 0);
  assert.equal(result.selected.length, 1);
  result = planSelection([{ ...paraphrase, duplicateChoice: 'keep' }, dependent], existing, suggestions);
  assert.equal(result.unresolved.size, 0);
  assert.equal(result.reusable.size, 0);
  assert.equal(result.selected.length, 2);
});
test('semantic hints fail closed for stale content, missing/foreign targets and different dates', () => {
  const paraphrase = { ...item, title: 'Secure venue booking', existingTaskIndex: 0 };
  const existing = [{ id: 'old', title: 'Book the venue', start: '' }];
  const suggestions = duplicateSuggestions([paraphrase], existing);
  for (const patch of [{title:'Book a different venue'}, {note:'Additional room'}, {start:'2030-10-05T09:00'}, {location:'Other city'}, {kind:'activity'}, {dueDate:'2030-11-01'}]) {
    const result = planSelection([{...paraphrase,...patch,duplicateChoice:'reuse'},dependent],existing,suggestions);
    assert.equal(result.reusable.size,0);
    assert.equal(result.invalidReuse.has('one'),true);
  }
  for (const targets of [[], [{...existing[0],id:'foreign'}], [{...existing[0],title:'Cancel venue'}]]) {
    assert.equal(planSelection([{...paraphrase,duplicateChoice:'reuse'}],targets,suggestions).invalidReuse.size,1);
  }
  for (const index of [-1, 99, null, undefined]) assert.equal(duplicateSuggestions([{...paraphrase,existingTaskIndex:index}],existing).length,0);
  assert.equal(duplicateSuggestions([{...paraphrase,start:'2030-10-05T09:00'}],existing).length,0);
  assert.equal(planSelection([{...paraphrase,duplicateChoice:'reuse'}],existing,[]).invalidReuse.size,1);
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
