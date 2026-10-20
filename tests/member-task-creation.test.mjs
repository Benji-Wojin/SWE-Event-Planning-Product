import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import '../legacy/calendar.js';
import '../legacy/store.js';

const fresh = () => GatherStore.createStore({storage:null});
test('task creation defaults off, is organizer-controlled and survives export/load', () => {
  const store=fresh();
  assert.equal(store.getState().event.membersCanCreateTasks,false);
  assert.throws(()=>store.addTask({title:'Member task'},'maya'),/organizer/);
  assert.throws(()=>store.updateEvent({membersCanCreateTasks:true},'maya'),/organizer/);
  assert.throws(()=>store.completeSetup({membersCanCreateTasks:true},'maya'),/organizer/);
  for(const value of ['true','false',1,null,{}])assert.throws(()=>store.updateEvent({membersCanCreateTasks:value}),/teammates/);
  store.updateEvent({membersCanCreateTasks:true});
  const raw=store.exportState();
  const loaded=GatherStore.createStore({storage:{getItem:()=>raw,setItem(){}}});
  assert.equal(loaded.getState().event.membersCanCreateTasks,true);
  store.updateEvent({membersCanCreateTasks:false});
  assert.throws(()=>store.addTask({title:'No longer allowed'},'maya'),/organizer/);
});
test('enabled teammates create only ordinary self-assigned or unassigned tasks',()=>{
  const store=fresh();store.updateEvent({membersCanCreateTasks:true});
  const task=store.addTask({title:'Bring display cards',owner:'maya',note:'For the welcome desk',dueDate:'2026-11-20'},'maya');
  assert.equal(task.owner,'maya');assert.equal(task.status,'todo');assert.equal(task.updatedBy,'maya');
  assert.equal(task.requiresVerification,false);assert.equal(task.schedule,null);
  assert.equal(store.addTask({title:'Collect signs'},'maya').owner,'');
  const before=store.exportState();
  for(const fields of [{owner:'jack'},{status:'done'},{status:'progress'},{schedule:null},{requiresVerification:false},{essential:true},{membersCanCreateTasks:true}]) {
    assert.throws(()=>store.addTask({title:'Invalid member task',...fields},'maya'));
    assert.equal(store.exportState(),before);
  }
  assert.throws(()=>store.addTask({title:'Outsider task'},'not-a-member'),/member/);
  const organizerTask=store.addTask({title:'Organizer assignment',owner:'maya',status:'progress'});
  assert.equal(organizerTask.status,'progress');
});
test('UI exposes the organizer toggle and limits the teammate task form',()=>{
  const setup=readFileSync('app/setup/setup-client.tsx','utf8'),app=readFileSync('legacy/app.js','utf8');
  assert.match(setup,/Let teammates create tasks/);
  assert.match(setup,/membersCanCreateTasks: event.membersCanCreateTasks === true/);
  assert.match(setup,/aria-describedby="task-creation-help"/);
  assert.match(app,/const addButton = \(\) => canCreateTasks\(\)/);
  assert.match(app,/\[ui.actor,'Me · '\+member\(ui.actor\).name\]/);
});
