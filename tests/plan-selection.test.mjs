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
const { planSelection, duplicateSuggestions, selectNewPlanItems } = await import(
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
test('select-all-new skips existing and repeated exact signatures without altering proposal content',()=>{
  const items=[{...item,included:true,owner:'maya',dueDate:'2030-10-01'},
    {...item,id:'duplicate',title:'CONFIRM venue!',included:true},
    {...item,id:'new',title:'Prepare programme',owner:'jack',included:false},
    {...item,id:'repeat',title:'Prepare programme',included:true},
    {...item,id:'different-time',title:'Prepare programme',start:'2030-10-03T09:00',included:false}];
  const before=structuredClone(items),selected=selectNewPlanItems(items,[{id:'saved',title:'Confirm venue',start:''}]);
  assert.deepEqual(selected.map(i=>i.included),[false,false,true,false,true]);
  selected.forEach((next,index)=>assert.deepEqual({...next,included:before[index].included},before[index]));
  assert.deepEqual(items,before);assert.equal(planSelection(selected,[{id:'saved',title:'Confirm venue',start:''}]).duplicates.size,0);
});
test('batch selection preserves bound semantic reuse and never chooses keep for an unresolved hint',()=>{
  const existing=[{id:'old',title:'Book venue',start:''}],proposal={...item,title:'Secure venue',existingTaskIndex:0};
  const bound={...proposal,id:'reuse',duplicateChoice:'reuse',included:false};
  const unknown={...proposal,id:'unknown'},suggestions=duplicateSuggestions([bound,unknown],existing);
  const selected=selectNewPlanItems([bound,unknown],existing),result=planSelection(selected,existing,suggestions);
  assert.deepEqual(selected[0],bound);assert.equal(selected[1].included,true);assert.equal(selected[1].duplicateChoice,undefined);
  assert.equal(result.reusable.get('reuse'),'old');assert(result.unresolved.has('unknown'));
});
test('batch selection keeps prerequisite links and existing-task reuse behavior intact',()=>{
  const existing=[{id:'old',title:'Confirm venue',start:''}];
  const selected=selectNewPlanItems([item,{...dependent,included:false}],existing);
  assert.deepEqual(selected[1].dependsOn,['one']);assert.equal(selected[0].included,false);assert.equal(selected[1].included,true);
  assert.equal(planSelection(selected,existing).missing.length,0);
});
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
  for (const patch of [{title:'Book a different venue'}, {note:'Additional room'}, {scope:'A separate hall has been approved.'}, {start:'2030-10-05T09:00'}, {location:'Other city'}, {kind:'activity'}, {dueDate:'2030-11-01'}]) {
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
test('blank outcomes retain legacy semantic identities, but meaningful outcome changes require a fresh reuse decision',()=>{
  const proposal={...item,title:'Secure venue',existingTaskIndex:0},existing=[{id:'old',title:'Book venue',start:''}];
  const suggestions=duplicateSuggestions([proposal],existing);
  assert.equal(planSelection([{...proposal,scope:'  ',duplicateChoice:'reuse'}],existing,suggestions).reusable.get('one'),'old');
  const changed={...proposal,scope:'Room and arrival access approved.',duplicateChoice:'reuse'};
  assert.equal(planSelection([changed],existing,suggestions).invalidReuse.has('one'),true);
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
