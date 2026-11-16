import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/schedule-ui.js';

const now='2026-11-20T17:15:00Z';
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui=GatherScheduleUI.create({h,options:()=>'',statusBadge:status=>`<span>${h(status)}</span>`});
const activity=(id,extra={})=>({id,title:id,status:'todo',owner:'maya',schedule:{start:'2026-11-20T09:00',end:'2026-11-20T09:30',location:'Fictional hall'},...extra});
const state=tasks=>({event:{timeZone:'America/Los_Angeles'},members:[
  {id:'maya',name:'Maya Chen',active:true},{id:'jack',name:'Maya Ortiz',active:true},
  {id:'former',name:'Fictional <Former>',email:'PRIVATE-OWNER-EMAIL',active:false},
],tasks});
const render=(input,scope={})=>[ui.clock(input,now,scope).markup,ui.view(input,false,now,scope)];

test('live clock and dated cards retain responsibility and prerequisite warnings without changing saved progress',()=>{
  const input=state([activity('Guest welcome',{dependencies:[{taskId:'prep',kind:'dependency'}]}),
    {id:'prep',title:'PRIVATE-PREREQUISITE',status:'progress',owner:'jack',requiresVerification:true,reportedAt:now,note:'PRIVATE-NOTE'}]);
  const before=structuredClone(input);
  for(const html of render(input,{mine:true,actor:'maya'})){
    assert.match(html,/Scheduled now/);assert.match(html,/Acceptance not recorded/);assert.match(html,/Required work not complete/);
    assert.doesNotMatch(html,/PRIVATE-PREREQUISITE|PRIVATE-NOTE|data-action="(?:accept|complete|verify|claim)|<form(?! id="scheduleDateForm")/);
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
    assert.match(html,/Fictional &lt;Former&gt; · Inactive teammate/);assert.match(html,/Unassigned/);
    assert.doesNotMatch(html,/PRIVATE-MISSING-ID|PRIVATE-OWNER-EMAIL|Acceptance not recorded|<Former>/);
  }
  input.members.find(member=>member.id==='former').active=true;
  for(const html of render(input,{mine:true,actor:'former'})){
    assert.doesNotMatch(html,/Assigned owner unavailable|Missing owner|Inactive teammate/);assert.match(html,/Acceptance not recorded/);
  }
});

test('clock, Timeline and run sheet agree on full owner names and distinguish teammates with the same first name',()=>{
  const input=state([activity('Welcome desk'),activity('Sound check',{owner:'jack'}),
    activity('Old assignment',{owner:'former'}),activity('Unknown assignment',{owner:'PRIVATE-MISSING-ID'})]);
  const before=structuredClone(input);
  for(const html of [...render(input),ui.runSheet(input,now)]){
    for(const name of ['Maya Chen','Maya Ortiz','Fictional &lt;Former&gt; · Inactive teammate','Assigned owner unavailable'])
      assert.ok(html.includes(name),name+' is shown');
    assert.doesNotMatch(html,/PRIVATE-OWNER-EMAIL|PRIVATE-MISSING-ID/);
  }
  assert.deepEqual(input,before);
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
  const clock=ui.clock(input,now,{mine:true,actor:'maya'});
  assert.match(clock.markup,/Completion awaiting verification · 1[\s\S]*data-id="Mine"[\s\S]*Required work not complete/);
  assert.equal(clock.labels.has('Mine'),false,'verification review must not become a timetable progress cue');
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

test('verified prerequisite results give a blocked activity a read-only review cue across event views',()=>{
  const store=GatherStore.createStore({storage:null,now:Date.parse(now)});
  store.completeSetup({timeZone:'America/Los_Angeles'});
  const prerequisite=store.addTask({title:'PRIVATE-REQUIRED-TITLE',owner:'jack',requiresVerification:true});
  const related=store.addTask({title:'PRIVATE-RELATED-TITLE',owner:'jack'});
  const task=store.addTask({title:'Fictional welcome',owner:'maya',status:'blocked',
    note:'PRIVATE-PARENT-NOTE',schedule:activity('').schedule});
  store.addDependency(task.id,{taskId:prerequisite.id,kind:'dependency',reason:'PRIVATE-LINK-REASON'});
  store.addDependency(task.id,{taskId:related.id,kind:'related'});
  const scope={mine:true,actor:'maya',date:'2026-11-20'};
  const cue=/Review linked results/;
  function surfaces(expected) {
    const before=store.exportState(),snapshot=store.getState();
    const model=ui.runSheetModel(snapshot,now,scope),row=model.days[0].rows[0];
    const html=ui.runSheetMarkup(model),plain=ui.runSheetText(model);
    for(const output of [...render(snapshot,scope),html,plain]) {
      assert.equal(cue.test(output),expected);
      assert.doesNotMatch(output,/PRIVATE-(?:REQUIRED-TITLE|RELATED-TITLE|PARENT-NOTE|LINK-REASON|RESULT-TEXT)/);
      assert.doesNotMatch(output,/data-action="(?:resume-task|toggle-task|verify-task)"/);
    }
    assert.equal(row.status,'Blocked');
    assert.equal(row.statusWarnings.includes('Review linked results'),expected);
    const group=GatherScheduleUI.reviewItems(snapshot,now,scope).find(item=>item.title==='Review linked results');
    assert.deepEqual(group?.tasks.map(item=>item.id)??[],expected?[task.id]:[]);
    if(expected)assert.match(ui.preparationReview(snapshot,now,scope,true),/Review linked results · 1/);
    assert.equal(snapshot.tasks.find(item=>item.id===task.id).status,'blocked');
    assert.equal(store.exportState(),before);
  }
  surfaces(false);
  store.reportCompletion(prerequisite.id,'PRIVATE-RESULT-TEXT','jack');
  surfaces(false);
  store.verifyTask(prerequisite.id,'jack');
  surfaces(true);
  store.updateTask(prerequisite.id,{status:'todo'},'jack');
  surfaces(false);
});

test('linked-result review respects scope, scheduled dates and actual required links',()=>{
  const date='2026-11-21';
  const future={start:date+'T09:00',end:date+'T09:30',location:''};
  const dependency=taskId=>({taskId,kind:'dependency'});
  const tasks=[
    activity('ready-on-future-date',{status:'blocked',schedule:future,dependencies:[dependency('resolved')]}),
    activity('related-only',{status:'blocked',schedule:future,dependencies:[{taskId:'resolved',kind:'related'}]}),
    activity('missing-prerequisite',{status:'blocked',schedule:future,dependencies:[dependency('missing')]}),
    activity('parent-awaiting-review',{status:'blocked',schedule:future,requiresVerification:true,reportedAt:now,
      dependencies:[dependency('resolved')]}),
    activity('not-blocked',{status:'progress',schedule:future,dependencies:[dependency('resolved')]}),
    activity('another-owner',{status:'blocked',owner:'jack',schedule:future,dependencies:[dependency('resolved')]}),
    {id:'resolved',title:'PRIVATE-RESULT-TITLE',owner:'jack',status:'done',requiresVerification:true,verifiedAt:now,
      completionResult:{text:'PRIVATE-RESULT-TEXT'}},
  ];
  const snapshot=state(tasks),scope={mine:true,actor:'maya',date},cue=/Review linked results/;
  const datedAttention=ui.clock(snapshot,now,scope).markup;
  assert.match(datedAttention,/Completion awaiting verification · 1/);
  assert.match(datedAttention,/data-id="parent-awaiting-review"/);
  assert.doesNotMatch(datedAttention,/Scheduled now|\bNext\b|Check progress|Review linked results/,'the dated attention strip shows durable review only');
  const html=ui.view(snapshot,false,now,scope);
  assert.equal((html.match(/Review linked results/g)||[]).length,1);
  assert.match(html.match(/<button class="schedule-row"[^>]*data-id="ready-on-future-date"[\s\S]*?<\/button>/)?.[0]||'',cue);
  const rows=ui.runSheetModel(snapshot,now,scope).days.flatMap(day=>day.rows);
  assert.deepEqual(rows.filter(row=>row.statusWarnings.includes('Review linked results')).map(row=>row.title),['ready-on-future-date']);
  assert.doesNotMatch(html,/PRIVATE-RESULT|another-owner/);
  const otherDate={...scope,date:'2026-11-20'};
  assert.doesNotMatch(ui.view(snapshot,false,now,otherDate),cue);
  assert.doesNotMatch(ui.runSheet(snapshot,now,otherDate),cue);
  const group=GatherScheduleUI.reviewItems(snapshot,now,otherDate).find(item=>item.title==='Review linked results');
  assert.deepEqual(group?.tasks.map(item=>item.id),['ready-on-future-date'],'Before the event intentionally reviews all dates in My tasks');
});
