import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/reschedule.js';
import '../legacy/store.js';
const create=()=>{const store=GatherStore.createStore({storage:null});store.completeSetup({date:'2026-10-30',timeZone:'America/Los_Angeles'});return store;};
const get=(store,id)=>store.getState().tasks.find(task=>task.id===id);
const request=(store,tasks=[],toDate='2026-11-06')=>({fromDate:store.getState().event.date,toDate,timeZone:store.getState().event.timeZone,tasks});
const selected=(task,moveDue=true,moveSchedule=false)=>({id:task.id,revision:task.revision,moveDue,moveSchedule});
test('reviewed rescheduling saves once and preserves outcomes while owners reconfirm changed commitments',()=>{
  const store=create(),a=store.addTask({title:'School welcome team',owner:'maya',dueDate:'2026-10-23',status:'progress',note:'Signs drafted',schedule:{start:'2026-10-30T23:30',end:'2026-10-31T00:30',location:'Hall'}});
  store.acceptTask(a.id,'maya');store.setNextUp(a.id,{enabled:true},'maya');
  store.addDependency(a.id,{taskId:'venue',reason:'Confirm hall'});
  const before=store.getState(),old=get(store,a.id),input=request(store,[selected(old,true,true)]);let saves=0;store.subscribe(()=>saves++);
  const result=store.rescheduleEvent(input),after=get(store,a.id);
  assert.equal(saves,1);assert.deepEqual(result,{date:'2026-11-06',changedTaskCount:1});
  assert.equal(store.getState().event.date,'2026-11-06');assert.equal(after.dueDate,'2026-10-30');
  assert.deepEqual(after.schedule,{start:'2026-11-06T23:30',end:'2026-11-07T00:30',location:'Hall'});
  for(const field of ['status','owner','note','dependencies','reportedAt','verifiedAt','completedAt','completedBy','originalDueDate','updatedAt','completionEvidence'])assert.deepEqual(after[field],old[field],field);
  assert.equal(after.acceptedAt,'');assert.equal(after.nextUpAt,'');assert.equal(after.revision,old.revision+1);
  assert.equal(after.deadlineHistory.at(-1).from,old.dueDate);assert.equal(after.deadlineHistory.at(-1).to,after.dueDate);assert.equal(after.deadlineHistory.at(-1).actor,'jack');
  assert.match(after.comments.at(-1).text,/reconfirm/);assert.equal(after.comments.at(-1).actor,'jack');
  assert.deepEqual(store.getState().tasks.filter(t=>t.id!==a.id),before.tasks.filter(t=>t.id!==a.id));
  assert.equal(store.getState().event.cateringDeadline,before.event.cateringDeadline);
  const saved=store.exportState();assert.throws(()=>store.rescheduleEvent(input),/Reload/);assert.equal(store.exportState(),saved,'retry must not shift twice');
});
test('invalid, fixed, reported, completed and stale selections fail atomically',()=>{
  const store=create(),fixed=store.addTask({title:'School hall deposit',dueDate:'2026-10-20'});
  store.setTaskPriority(fixed.id,{priority:'auto',hardDeadline:true});
  const pending=store.addTask({title:'Report pending',owner:'maya',dueDate:'2026-10-20',requiresVerification:true});store.reportCompletion(pending.id,'Ready','maya');
  const done=store.addTask({title:'Completed',dueDate:'2026-10-20',status:'done'}),ok=store.addTask({title:'Move',dueDate:'2026-10-20'});
  const original=store.exportState(),valid=selected(get(store,ok.id));
  const bads=[request(store,[valid,selected(get(store,fixed.id))]),request(store,[valid,selected(get(store,pending.id))]),request(store,[valid,selected(get(store,done.id))]),
    request(store,[valid,{...valid,id:'foreign'}]),request(store,[valid,valid]),request(store,[{...valid,revision:0}]),request(store,[{...valid,actor:'maya'}]),request(store,[{...valid,moveDue:'true'}]),request(store,[{...valid,moveDue:false}]),
    {...request(store,[valid]),fromDate:'2026-10-29'},{...request(store,[valid]),timeZone:'UTC'},{...request(store,[valid]),status:'done'},request(store,[valid],'2026-02-30'),request(store,[valid],'2026-10-30'),request(store,Array.from({length:201},(_,i)=>({...valid,id:String(i)})))];
  for(const input of bads){assert.throws(()=>store.rescheduleEvent(input));assert.equal(store.exportState(),original);}
  for(const actor of ['maya','outsider']){assert.throws(()=>store.rescheduleEvent(request(store,[valid]),actor));assert.equal(store.exportState(),original);}
  store.updateTask(ok.id,{dueDate:'2026-10-21'});const changed=store.exportState();assert.throws(()=>store.rescheduleEvent(request(store,[valid])),/task changed/);assert.equal(store.exportState(),changed);
});
test('selection is per field; fixed deadlines remain while a separately chosen activity moves',()=>{
  const store=create(),a=store.addTask({title:'Vendor arrival',dueDate:'2026-10-20',schedule:{start:'2026-10-30T10:00',end:'',location:''}});
  store.setTaskPriority(a.id,{priority:'auto',hardDeadline:true});
  store.rescheduleEvent(request(store,[selected(get(store,a.id),false,true)]));
  assert.equal(get(store,a.id).dueDate,'2026-10-20');assert.equal(get(store,a.id).schedule.start,'2026-11-06T10:00');
  const before=store.getState().tasks;store.rescheduleEvent(request(store,[],'2026-11-13'));assert.deepEqual(store.getState().tasks,before,'date-only review leaves every task untouched');
});
test('calendar shifts preserve leap/month/year and DST calendar distances independent of viewer zone',()=>{
  for(const [from,to,days] of [['2028-02-28','2028-02-29',1],['2027-12-31','2028-01-01',1],['2026-11-02','2026-10-30',-3],['2026-03-07','2026-03-09',2]])assert.equal(GatherReschedule.shiftDay(from,days),to);
  for(const date of ['','2026-02-29','0000-01-01','0999-01-01','10000-01-01'])assert.throws(()=>GatherReschedule.shiftDay(date,1));
  assert.throws(()=>GatherReschedule.shiftDay('9999-12-31',1));assert.throws(()=>GatherReschedule.shiftDay('1000-01-01',-1));
  const store=create();store.addTask({title:'Overflow',dueDate:'9999-12-31'});const plan=GatherReschedule.preview(store.getState(),'2026-11-06');assert.ok(plan.rows.find(row=>row.title==='Overflow').dueError);
  for(const zone of ['America/Los_Angeles','Asia/Tokyo','Pacific/Auckland']){
    const out=execFileSync(process.execPath,['--input-type=module','-e',"import './legacy/reschedule.js';console.log(GatherReschedule.shiftDay('2026-10-30',7));"],{encoding:'utf8',env:{...process.env,TZ:zone}});assert.equal(out.trim(),'2026-11-06');
  }
});
test('review markup is explicit, escaped, unselected and available through versioned hosted assets',()=>{
  const store=create();store.addTask({title:'<img src=x onerror=attack>',dueDate:'2026-10-20'});
  const h=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const html=GatherReschedule.reviewMarkup(store.getState(),GatherReschedule.preview(store.getState(),'2026-11-06'),h);
  assert.doesNotMatch(html,/<img| checked/);assert.match(html,/&lt;img/);assert.match(html,/required/);assert.match(html,/Nothing is selected automatically/);assert.match(html,/budget due dates/);assert.match(html,/owners can reconfirm/);
  execFileSync(process.execPath,['scripts/prepare.mjs']);
  assert.match(readFileSync('public/workspace.html','utf8'),/\/gather-assets\/versioned\/[a-f0-9]{20}-reschedule\.js/);
  assert.match(readFileSync('public/gather-assets/app.js','utf8'),/const result=await store\.rescheduleEvent\(/);
  assert.match(readFileSync('legacy/hosted-store.js','utf8'),/rescheduleEvent: 1/);
});
test('DST gaps, repeated times and skipped dates require separate activity review, not a guessed instant',()=>{
  assert.equal(GatherReschedule.uniqueLocalTime('2026-03-08T02:30','America/Los_Angeles'),false);
  assert.equal(GatherReschedule.uniqueLocalTime('2026-11-01T01:30','America/Los_Angeles'),false);
  assert.equal(GatherReschedule.uniqueLocalTime('2026-11-01T03:30','America/Los_Angeles'),true);
  assert.equal(GatherReschedule.uniqueLocalTime('2026-11-01T09:30','Asia/Kolkata'),true);
  assert.equal(GatherReschedule.uniqueLocalTime('2011-12-30T10:00','Pacific/Apia'),false);
  const store=create();store.completeSetup({date:'2026-03-01'});
  const task=store.addTask({title:'Early setup',dueDate:'2026-02-27',schedule:{start:'2026-03-01T02:30',end:'2026-03-01T03:30',location:'Hall'}});
  const row=GatherReschedule.preview(store.getState(),'2026-03-08').rows.find(row=>row.id===task.id);
  assert.equal(row.due,'2026-03-06');assert.equal(row.schedule,null);assert.match(row.scheduleError,/ambiguous or unavailable/);
  const before=store.exportState();assert.throws(()=>store.rescheduleEvent(request(store,[selected(task,false,true)],'2026-03-08')));assert.equal(store.exportState(),before);
});
test('hosted review captures checked fields before locking, awaits the server and preserves a failed draft',async()=>{
  execFileSync(process.execPath,['scripts/prepare.mjs']);const source=readFileSync('public/gather-assets/app.js','utf8');
  const handler=source.slice(source.indexOf("  document.addEventListener('submit'"),source.indexOf("  document.addEventListener('change'"));
  for(const succeed of [false,true]){
    let submit,resolve,reject,locked=false,payload;const events=[];
    const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});
    const due={checked:true},activity={checked:false},row={dataset:{rescheduleRow:'task-1',revision:'7'}};
    const form={id:'rescheduleReviewForm',isConnected:true,dataset:{actor:'jack',from:'2026-10-30',to:'2026-11-06',zone:'America/Los_Angeles'},closest(){return this;}};
    const context=vm.createContext({document:{addEventListener:(_type,fn)=>submit=fn},window:{},ui:{actor:'jack'},isOrganizer:()=>true,
      FormData:class{constructor(){return [['confirmed','on']];}},$$:selector=>selector==='[data-reschedule-row]'?[row]:[],
      $:selector=>selector==='[data-move-due]'?due:selector==='[data-move-schedule]'?activity:null,
      saveLock(){locked=true;due.checked=false;return()=>{locked=false;};},
      store:{rescheduleEvent:input=>{payload=JSON.parse(JSON.stringify(input));return pending;}},
      formError:(_form,error)=>events.push('error:'+error.message),toast:text=>events.push(text),showPendingUpdate:()=>events.push('pending'),render:()=>events.push('render'),closeDialog:()=>events.push('close')});
    vm.runInContext(handler,context);const saved=submit({target:form,preventDefault(){},submitter:{}});await Promise.resolve();
    assert.ok(locked);assert.deepEqual(events,[]);assert.deepEqual(payload,{fromDate:'2026-10-30',toDate:'2026-11-06',timeZone:'America/Los_Angeles',tasks:[{id:'task-1',revision:7,moveDue:true,moveSchedule:false}]});
    if(succeed)resolve({changedTaskCount:1});else reject(Object.assign(new Error('Review latest dates'),{status:409}));await saved;
    assert.equal(locked,false);
    if(succeed)assert.deepEqual(events.slice(0,2),['close','render']);else assert.deepEqual(events,['pending','error:Review latest dates','Review latest dates']);
  }
});
