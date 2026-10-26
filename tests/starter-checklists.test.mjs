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
      assert.equal(typeof item.scope,'string');assert.ok(item.scope.trim().length>30&&item.scope.length<=3000);
      assert.doesNotMatch(item.scope,/https?:\/\/|@|password|\u0000/i);
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
  const plan=starterChecklist('school');plan.items[0].title='Changed';plan.items[0].scope='Changed outcome';plan.items.find(i=>i.dependsOn.length).dependsOn.push('made-up');
  const fresh=starterChecklist('school');assert.notEqual(fresh.items[0].title,'Changed');assert.doesNotThrow(()=>parsePlanItems(fresh.items));
  assert.notEqual(fresh.items[0].scope,'Changed outcome');
  for(const bad of ['__proto__','constructor','unknown','School'])assert.throws(()=>starterChecklist(bad),/supported event type/);
});
test('optional starter dates are editable calendar-day suggestions with unset owners and activity times',()=>{
  for(const kind of eventKinds){
    const plan=starterChecklist(kind,{eventDate:'2028-03-12',endDate:'2028-03-14',today:'2028-01-01'});
    assert.doesNotThrow(()=>parsePlanItems(plan.items));
    assert.ok(plan.items.every(i=>i.dueDate && !i.start && !i.end && !i.owner));
    assert.ok(plan.assumptions.some(s=>s.includes('not confirmed deadlines')));
    for(const item of plan.items)for(const dependency of item.dependsOn)assert.ok(plan.items.find(i=>i.id===dependency).dueDate<=item.dueDate);
    assert.equal(plan.scheduleWarnings,undefined);
  }
  const school=starterChecklist('school',{eventDate:'2028-03-12',endDate:'2028-03-14',today:'2028-01-01'});
  assert.equal(school.items.find(i=>i.id==='av').dueDate,'2028-03-10');
  assert.equal(school.items.find(i=>i.id==='needs').dueDate,'2028-02-20');
  assert.equal(school.items.find(i=>i.id==='feedback').dueDate,'2028-03-16');
  assert.equal(starterChecklist('corporate',{eventDate:'2028-03-12',endDate:'2028-03-14',today:'2028-01-01'}).items.find(i=>i.id==='followup').dueDate,'2028-03-15');
});
test('short-notice suggestions never backdate preparation and disclose compressed lead times',()=>{
  const plan=starterChecklist('school',{eventDate:'2026-10-25',endDate:'',today:'2026-10-24'});
  assert.ok(plan.items.every(i=>i.dueDate>='2026-10-24'));
  assert.equal(plan.items.find(i=>i.id==='purpose').dueDate,'2026-10-24');
  assert.equal(plan.items.find(i=>i.id==='feedback').dueDate,'2026-10-27');
  assert.match(plan.scheduleWarnings.join(' '),/Short notice/);assert.match(plan.scheduleWarnings.join(' '),/Review what is feasible/);
  assert.ok(starterChecklist('party').items.every(i=>!i.dueDate));
});
test('dated starters reject missing, malformed, past or reversed dates and calendar overflow',()=>{
  const valid={eventDate:'2026-12-01',endDate:'',today:'2026-10-24'};
  for(const value of [{eventDate:''},{today:''},{eventDate:'2026-02-30'},{today:'bad'},{eventDate:'2026-10-23'},{endDate:'2026-11-30'},{eventDate:'9999-12-31',endDate:'9999-12-31'}])
    assert.throws(()=>starterChecklist('school',{...valid,...value}));
});
