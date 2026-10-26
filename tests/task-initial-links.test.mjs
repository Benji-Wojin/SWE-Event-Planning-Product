import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../legacy/calendar.js';
import '../legacy/store.js';
const create=()=>GatherStore.createStore({storage:null});

test('new tasks accept reviewed initial links in one save without modifying prerequisite records',()=>{
  const store=create(),prerequisite=store.addTask({title:'Review fictional supplier scope',owner:'maya',note:'PRIVATE-PREREQUISITE-NOTE'});
  const before=store.getState().tasks.find(task=>task.id===prerequisite.id);let saves=0;store.subscribe(()=>saves++);
  const task=store.addTask({title:'Confirm fictional supplier scope',owner:'jack',note:'Use the reviewed scope before confirming.',dependencies:[{taskId:prerequisite.id,kind:'dependency',reason:'The reviewed scope is required.'}]});
  assert.equal(saves,1);assert.equal(task.status,'todo');assert.equal(task.acceptedAt,'');assert.equal(task.schedule,null);
  assert.equal(task.dependencies.length,1);assert.equal(task.dependencies[0].taskId,prerequisite.id);
  assert.deepEqual(store.getState().tasks.find(task=>task.id===prerequisite.id),before);
  assert.doesNotMatch(JSON.stringify(task),/PRIVATE-PREREQUISITE-NOTE/);
  assert.throws(()=>store.reportCompletion(task.id,'Not ready.','jack'),/required|complete|linked|prerequisite/i);
});

test('enabled teammate can create self or unassigned linked work with their own attribution, not edit prior tasks',()=>{
  const store=create();store.updateEvent({membersCanCreateTasks:true});
  const before=store.getState().tasks.find(task=>task.id==='dietary');
  for(const owner of ['maya','']){
    const task=store.addTask({title:'Fictional teammate follow-up '+owner,owner,dependencies:[{taskId:'dietary',kind:'dependency',reason:'Needs the agreed count.'}]},'maya');
    assert.equal(task.owner,owner);assert.equal(task.updatedBy,'maya');assert.equal(task.comments[0].actor,'maya');
    assert.equal(task.dependencies[0].kind,'dependency');assert.equal(task.status,'todo');
  }
  assert.deepEqual(store.getState().tasks.find(task=>task.id==='dietary'),before);
  const raw=store.exportState();assert.throws(()=>store.addTask({title:'Forged assignment',owner:'jack',dependencies:[]},'maya'),/yourself|unassigned/i);assert.equal(store.exportState(),raw);
  store.updateEvent({membersCanCreateTasks:false});const disabled=store.exportState();assert.throws(()=>store.addTask({title:'Disabled',dependencies:[]},'maya'),/organizer/);assert.equal(store.exportState(),disabled);
});

test('initial links validate the entire request before creation and cannot bypass completion gates',()=>{
  const store=create(),link={taskId:'dietary',kind:'dependency',reason:'Needs the final count.'};
  for(const dependencies of [null,{},[null],[{...link,taskId:'missing'}],[{...link,reason:''}],[{...link,reason:'x'.repeat(2001)}],[{...link,kind:'other'}],[{...link,automatic:true}],[link,link],Array(9).fill(link)]){
    const raw=store.exportState();assert.throws(()=>store.addTask({title:'Invalid linked work',dependencies}));assert.equal(store.exportState(),raw);
  }
  const raw=store.exportState();assert.throws(()=>store.addTask({title:'Bypass',status:'done',dependencies:[link]}),/incomplete/);assert.equal(store.exportState(),raw);
  const related=store.addTask({title:'Parallel work',owner:'jack',dependencies:[{...link,kind:'related'}]});
  store.reportCompletion(related.id,'Parallel work finished.','jack');assert.equal(store.getState().tasks.find(task=>task.id===related.id).status,'done');
});
