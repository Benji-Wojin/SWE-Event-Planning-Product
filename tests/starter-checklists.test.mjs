import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
let starterChecklist,parsePlanItems,eventKinds;
before(async()=>{
  const bundle=await build({stdin:{contents:"export {starterChecklist} from './lib/starter-checklists';export {parsePlanItems,eventKinds} from './lib/plan-generation';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
  ({starterChecklist,parsePlanItems,eventKinds}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64')));
});
test('every supported event kind has a bounded editable starter with unknown dates and owners left unset',()=>{
  for(const kind of eventKinds){
    const plan=starterChecklist(kind);
    assert.ok(plan.items.length>=6&&plan.items.length<=24);
    assert.doesNotThrow(()=>parsePlanItems(plan.items));
    for(const item of plan.items){
      for(const field of ['dueDate','start','end','location'])assert.equal(item[field],'');
      assert.equal(item.owner,undefined);assert.equal(item.existingTaskIndex,null);
      assert.doesNotMatch(item.note,/https?:\/\/|@|confirmed booking:|password/i);
    }
    assert.ok(plan.assumptions.some(s=>s.includes('not AI-generated')));
    assert.ok(plan.assumptions.some(s=>s.includes('not a complete')));
  }
});
test('formal events get deeper delivery checks while celebrations stay proportional',()=>{
  const school=starterChecklist('school'),corporate=starterChecklist('corporate'),party=starterChecklist('party');
  assert.ok(school.items.length>=party.items.length+4);assert.ok(corporate.items.length>=party.items.length+4);
  const titles=plan=>plan.items.map(item=>item.title).join(' ');
  assert.match(titles(school),/school approval and supervision/);assert.match(titles(school),/arrival and release/);
  assert.match(titles(corporate),/stakeholder decisions/);assert.match(titles(corporate),/supplier scope/);
  assert.match(titles(corporate),/AV and remote participation/);assert.match(titles(corporate),/post-event actions/);
  assert.match(titles(starterChecklist('trip')),/flexible itinerary/);
  assert.match(titles(starterChecklist('anniversary')),/personal touches/);
});
test('starter outputs are fresh copies and prototype keys cannot select a checklist',()=>{
  const plan=starterChecklist('school');plan.items[0].title='Changed';plan.items.find(i=>i.dependsOn.length).dependsOn.push('made-up');
  const fresh=starterChecklist('school');assert.notEqual(fresh.items[0].title,'Changed');assert.doesNotThrow(()=>parsePlanItems(fresh.items));
  for(const bad of ['__proto__','constructor','unknown','School'])assert.throws(()=>starterChecklist(bad),/supported event type/);
});
