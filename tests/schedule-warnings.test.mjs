import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/schedule-ui.js';

const now='2026-11-20T17:15:00Z';
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui=GatherScheduleUI.create({h,options:()=>'',person:id=>`<span>${h(id||'Unassigned')}</span>`,statusBadge:status=>`<span>${h(status)}</span>`});
const activity=(id,extra={})=>({id,title:id,status:'todo',owner:'maya',schedule:{start:'2026-11-20T09:00',end:'2026-11-20T09:30',location:'Fictional hall'},...extra});
const state=tasks=>({event:{timeZone:'America/Los_Angeles'},members:[{id:'maya',active:true},{id:'jack',active:true},{id:'former',active:false}],tasks});
const render=(input,scope={})=>[ui.clock(input,now,scope).markup,ui.view(input,false,now,scope)];

test('live clock and dated cards retain responsibility and prerequisite warnings without changing saved progress',()=>{
  const input=state([activity('Guest welcome',{dependencies:[{taskId:'prep',kind:'dependency'}]}),
    {id:'prep',title:'PRIVATE-PREREQUISITE',status:'progress',owner:'jack',requiresVerification:true,reportedAt:now,note:'PRIVATE-NOTE'}]);
  const before=structuredClone(input);
  for(const html of render(input,{mine:true,actor:'maya'})){
    assert.match(html,/Scheduled now/);assert.match(html,/Acceptance not recorded/);assert.match(html,/Required work not complete/);
    assert.doesNotMatch(html,/PRIVATE-PREREQUISITE|PRIVATE-NOTE|data-action="(?:accept|complete|verify|claim)|<form/);
  }
  assert.deepEqual(input,before);
  input.tasks[0].acceptedAt=now;
  for(const html of render(input)) {assert.doesNotMatch(html,/Acceptance not recorded/);assert.match(html,/Required work not complete/);}
  input.tasks[1].status='done';input.tasks[1].verifiedAt=now;
  for(const html of render(input))assert.doesNotMatch(html,/Required work not complete/);
  assert.equal(input.tasks[0].status,'todo');
});

test('live owner presentation distinguishes inactive, missing and unassigned without leaking missing IDs',()=>{
  const input=state([activity('Former owner',{owner:'former'}),activity('Missing owner',{owner:'PRIVATE-MISSING-ID'}),activity('Unassigned',{owner:''})]);
  for(const [index,html] of render(input).entries()){
    assert.equal((html.match(/Assigned owner unavailable/g)||[]).length,index===0?2:4,'dated view includes focus and dated cards');
    assert.match(html,/former/);assert.match(html,/Unassigned/);assert.doesNotMatch(html,/PRIVATE-MISSING-ID|Acceptance not recorded/);
  }
  input.members.find(member=>member.id==='former').active=true;
  for(const html of render(input,{mine:true,actor:'former'})){
    assert.doesNotMatch(html,/Assigned owner unavailable|Missing owner/);assert.match(html,/Acceptance not recorded/);
  }
});

test('warnings preserve required versus related semantics, selected scope and completion verification',()=>{
  const input=state([activity('Mine',{acceptedAt:now,dependencies:[{taskId:'related',kind:'related'}]}),
    activity('Other',{owner:'jack',dependencies:[{taskId:'missing'}]}),{id:'related',title:'PRIVATE-RELATED',status:'todo'}]);
  for(const html of render(input,{mine:true,actor:'maya'}))assert.doesNotMatch(html,/Required work not complete|Acceptance not recorded|PRIVATE-RELATED|data-id="Other"/);
  input.tasks[0].dependencies.push({taskId:'absent',kind:'dependency'});
  for(const html of render(input,{mine:true,actor:'maya'}))assert.match(html,/Required work not complete/);
  input.tasks[0].status='done';
  for(const html of render(input,{mine:true,actor:'maya'}))assert.doesNotMatch(html,/Required work not complete|Acceptance not recorded/);
  input.tasks[0].requiresVerification=true;
  assert.match(ui.view(input,false,now,{mine:true,actor:'maya'}),/Awaiting verification[\s\S]*Required work not complete/);
  assert.doesNotMatch(ui.clock(input,now,{mine:true,actor:'maya'}).markup,/data-id="Mine"/);
});

test('live warnings follow explicit saved acceptance, reporting, verification and reassignment',()=>{
  const store=GatherStore.createStore({storage:null});store.completeSetup({timeZone:'America/Los_Angeles'});
  const prep=store.addTask({title:'Fictional required check',owner:'maya',requiresVerification:true});
  const task=store.addTask({title:'Fictional welcome',owner:'jack',schedule:activity('').schedule});
  store.addDependency(task.id,{taskId:prep.id,kind:'dependency'});
  const html=()=>render(store.getState(),{mine:true,actor:'jack'});
  for(const value of html()){assert.match(value,/Acceptance not recorded/);assert.match(value,/Required work not complete/);}
  store.acceptTask(task.id,'jack');
  store.reportCompletion(prep.id,'Fictional check reported.','maya');
  for(const value of html()){assert.doesNotMatch(value,/Acceptance not recorded/);assert.match(value,/Required work not complete/);}
  store.verifyTask(prep.id,'jack');
  for(const value of html())assert.doesNotMatch(value,/Required work not complete/);
  store.updateTask(task.id,{owner:'maya'});
  assert.equal(ui.clock(store.getState(),now,{mine:true,actor:'jack'}).markup,'');
  for(const value of render(store.getState(),{mine:true,actor:'maya'}))assert.match(value,/Acceptance not recorded/);
  const record=store.getState().tasks.find(item=>item.id===task.id);
  assert.equal(record.status,'todo');assert.deepEqual(record.schedule,task.schedule);
});
