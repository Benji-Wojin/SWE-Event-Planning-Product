import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../legacy/store.js';

const create = () => GatherStore.createStore({storage:null});
const task = (store,id) => store.getState().tasks.find(t=>t.id===id);
const results = (store,id) => task(store,id).comments.filter(c=>c.kind==='dependency-result');

test('new and updated blockers create or reuse follow-up tasks, including repeat reports and reloads', () => {
  const store=create();
  const parent=store.addTask({title:'Approve dinner menu',owner:'dev'});
  store.updateTask(parent.id,{status:'blocked',note:'Waiting for dietary restrictions from our guests.'},'dev');
  assert.equal(task(store,parent.id).dependencies[0].taskId,'dietary');
  const count=store.getState().tasks.length;
  store.updateTask(parent.id,{status:'blocked',note:'Still waiting for the final dietary restrictions.'},'dev');
  assert.equal(store.getState().tasks.length,count);
  store.updateTask(parent.id,{status:'blocked',note:'The budget approval is also missing.'},'dev');
  assert.equal(task(store,parent.id).dependencies.length,2);
  assert.equal(store.getState().tasks.length,count+1);
  const followup=task(store,task(store,parent.id).dependencies[1].taskId);
  assert.equal(followup.title,'Approve budget: Approve dinner menu');
  assert.equal(followup.owner,'');
  const raw=store.exportState();
  const reloaded=GatherStore.createStore({storage:{getItem:k=>k===GatherStore.STORAGE_KEY?raw:null,setItem:()=>{}}});
  assert.equal(reloaded.getState().tasks.length,count+1);
  store.updateTask(parent.id,{status:'blocked',note:'The budget approval is also missing.'},'dev');
  assert.equal(store.getState().tasks.length,count+1);
  const custom=store.addTask({title:'Install lighting',owner:'jules',status:'blocked',note:'We need the electrician to inspect the fuse box.'});
  assert.equal(custom.dependencies.length,1);
  assert.match(task(store,custom.dependencies[0].taskId).note,/electrician/);
});

test('completion shares a result once and requires explicit owner resume after every dependency resolves', () => {
  const store=create();
  const second=store.addTask({title:'Check seating',owner:'dev'});
  store.addDependency('catering',{taskId:second.id},'maya');
  store.reportCompletion('dietary','24 vegetarian meals; 3 gluten-free meals. Caterer has the list.','maya');
  assert.equal(task(store,'catering').status,'blocked');
  assert.match(results(store,'catering')[0].text,/24 vegetarian meals; 3 gluten-free meals/);
  store.addComment('dietary','Thanks!','jack');
  assert.equal(results(store,'catering').length,1);
  assert.throws(()=>store.resumeTask('catering','maya'),/still open/);
  store.reportCompletion(second.id,'The seating plan is attached to the shared event folder.','dev');
  assert.equal(results(store,'catering').length,2);
  assert.throws(()=>store.resumeTask('catering','jules'),/owner or the organizer/);
  store.resumeTask('catering','maya');
  assert.equal(task(store,'catering').status,'progress');
  assert.ok(task(store,'catering').comments.some(c=>c.text.includes('24 vegetarian')));
});

test('verification delays delivery; reopening invalidates readiness and sends the new result on recompletion', () => {
  const store=create();
  store.updateTask('dietary',{requiresVerification:true});
  store.reportCompletion('dietary','Initial dietary list ready.','maya');
  assert.equal(results(store,'catering').length,0);
  assert.throws(()=>store.resumeTask('catering','maya'),/still open/);
  store.verifyTask('dietary','jack');
  assert.equal(results(store,'catering').length,1);
  store.updateTask('dietary',{status:'progress',note:'One guest changed their response.'});
  assert.throws(()=>store.resumeTask('catering','maya'),/still open/);
  assert.equal(task(store,'catering').comments.filter(c=>c.kind==='dependency-reopened').length,1);
  store.reportCompletion('dietary','Updated list: 25 vegetarian meals.','maya');
  assert.equal(results(store,'catering').length,1);
  store.verifyTask('dietary');
  assert.equal(results(store,'catering').length,2);
  assert.match(results(store,'catering')[1].text,/25 vegetarian/);
});

test('reviewed emails create blocker links and share completion results after application, never before', () => {
  const store=create();
  const parent=store.addTask({title:'Confirm venue refreshments',owner:'dev'});
  const blocker=store.addMessage({sender:'Dev Kim',subject:'Refreshments update',taskId:parent.id,body:'I am blocked waiting for dietary restrictions.'});
  assert.equal(task(store,parent.id).dependencies.length,0);
  store.applyMessage(blocker.id,{});
  assert.equal(task(store,parent.id).dependencies[0].taskId,'dietary');
  assert.equal(results(store,parent.id).length,0);
  store.applyMessage('email-dietary',{});
  assert.equal(results(store,parent.id).length,1);
  assert.equal(task(store,parent.id).status,'blocked');
});

test('dependency management rejects cycles, self-links, cross-owner changes and forged assignment', () => {
  const store=create();
  store.updateTask('dietary',{status:'blocked',note:'We need the guest form repaired.'},'maya');
  const before=store.exportState();
  assert.throws(()=>store.addDependency('dietary',{taskId:'catering'},'maya'),/depend on each other/);
  assert.throws(()=>store.addDependency('catering',{taskId:'catering'},'maya'),/depend on each other/);
  assert.throws(()=>store.addDependency('catering',{title:'Make something',owner:'jack'},'maya'),/Choose an existing/);
  assert.throws(()=>store.addDependency('catering',{title:'Make something'},'jules'),/owner or the organizer/);
  assert.throws(()=>store.removeDependency('catering','dietary','jules'),/owner or the organizer/);
  assert.equal(store.exportState(),before);
  store.removeDependency('catering','dietary','maya');
  assert.ok(task(store,'dietary'));
  assert.equal(task(store,'catering').dependencies.length,0);
});

test('existing plans migrate links without creating work; repeated blockers do not reuse a finished round', () => {
  const store=create();
  const old=JSON.parse(store.exportState());
  old.tasks.forEach(t=>{delete t.dependencies;delete t.blockerFingerprint;});
  const reloaded=GatherStore.createStore({storage:{getItem:k=>k===GatherStore.STORAGE_KEY?JSON.stringify(old):null,setItem:()=>{}}});
  assert.equal(reloaded.getState().tasks.length,old.tasks.length);
  assert.equal(task(reloaded,'catering').dependencies[0].taskId,'dietary');
  store.reportCompletion('dietary','Collected all responses.','maya');
  store.resumeTask('catering','maya');
  store.updateTask('catering',{status:'blocked',note:'Waiting for dietary restrictions from three new guests.'},'maya');
  const deps=task(store,'catering').dependencies;
  assert.equal(deps.length,2);
  assert.notEqual(deps[1].taskId,'dietary');
  assert.equal(task(store,deps[1].taskId).status,'todo');
});

test('multiple blocker clauses link both tasks; resolved mentions do not generate new dietary work', () => {
  const store=create();
  const parent=store.addTask({title:'Approve dinner',owner:'dev',status:'blocked',note:'Waiting for dietary needs and budget approval.'});
  assert.equal(parent.dependencies.length,2);
  store.reportCompletion('dietary','All dietary needs recorded.','maya');
  assert.throws(()=>store.resumeTask(parent.id,'dev'),/still open/);
  const before=store.getState().tasks.length;
  store.updateTask(parent.id,{status:'blocked',note:'Dietary needs are resolved. Waiting for budget approval.'},'dev');
  assert.equal(store.getState().tasks.length,before);
  assert.equal(task(store,parent.id).dependencies.length,2);
});

test('generic blockers remain distinct and completed results are immutable on ordinary note edits', () => {
  const store=create();
  const a=store.addTask({title:'Reserve venue',status:'blocked',note:'Waiting for confirmation.'});
  const b=store.addTask({title:'Arrange ambulance',status:'blocked',note:'Waiting for confirmation.'});
  assert.notEqual(a.dependencies[0].taskId,b.dependencies[0].taskId);
  store.reportCompletion('dietary','2 nut allergies; caterer informed.','maya');
  const result=task(store,'dietary').completionResult;
  store.updateTask('dietary',{note:'Planning next year.'},'jack');
  assert.deepEqual(task(store,'dietary').completionResult,result);
  assert.equal(results(store,'catering').length,1);
  assert.match(results(store,'catering')[0].text,/2 nut allergies/);
  store.updateTask('volunteers',{requiresVerification:true});
  const before=store.exportState();
  assert.throws(()=>store.updateTask('volunteers',{status:'done'}),/verification/);
  assert.equal(store.exportState(),before);
});
