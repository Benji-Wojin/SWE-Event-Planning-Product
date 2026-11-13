import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/schedule-ui.js';

const now=Date.parse('2026-10-01T12:00:00Z');
const slot={start:'2026-10-03T09:30',end:'2026-10-03T10:00',location:'East entrance'};
const create=()=>{const store=GatherStore.createStore({storage:null,now});store.completeSetup({timeZone:'America/Los_Angeles'});return store;};
const task=(store,id='dietary')=>store.getState().tasks.find(task=>task.id===id);
const reload=raw=>GatherStore.createStore({storage:{getItem:key=>key===GatherStore.STORAGE_KEY?raw:null,setItem(key,value){if(key===GatherStore.STORAGE_KEY)raw=value;}}});

test('schedule persists without changing preparation deadlines, progress, reports or other tasks',()=>{
  const store=create();
  store.updateTask('dietary',{requiresVerification:true});
  store.acceptTask('dietary','maya');
  store.reportCompletion('dietary','The list is ready.','maya');
  const before=store.getState(),original=task(store);
  const saved=store.setTaskSchedule('dietary',slot);
  assert.deepEqual({...saved,schedule:original.schedule,revision:original.revision},original);
  assert.equal(saved.revision,original.revision+1);
  assert.deepEqual(store.getState().tasks.filter(t=>t.id!=='dietary'),before.tasks.filter(t=>t.id!=='dietary'));
  assert.deepEqual(task(reload(store.exportState())).schedule,slot);
  const noOp=store.exportState();store.setTaskSchedule('dietary',slot);assert.equal(store.exportState(),noOp);
  store.setTaskSchedule('dietary',null);
  assert.deepEqual({...task(store),revision:original.revision},original);
});

test('changing, adding or removing a schedule clears only open-work commitments and leaves an explanation',()=>{
  const store=create();
  const original=store.addTask({title:'Greet guests',owner:'maya',dueDate:'2026-10-02',note:'The route is ready.',schedule:slot});
  const id=original.id;
  store.updateTask(id,{status:'progress',note:'The route is marked.'},'maya');
  store.setNextUp(id,{enabled:true},'maya');
  let before=task(store,id),raw=store.exportState();
  store.setTaskSchedule(id,{...slot,location:'  East entrance  '});
  assert.equal(store.exportState(),raw,'an unchanged normalized schedule must keep acceptance');
  const check=(next,message)=>{
    const saved=store.setTaskSchedule(id,next),comment=saved.comments.at(-1);
    assert.equal(saved.revision,before.revision+1);
    for(const key of ['acceptedAt','acceptedBy','acceptedSourceId','acceptedRecordedBy','nextUpAt','nextUpBy'])assert.equal(saved[key],'',key);
    for(const key of ['owner','status','dueDate','note','noteUpdatedAt','noteUpdatedBy','ownerRespondedAt','dependencies','recoveryRequests','completionReview'])assert.deepEqual(saved[key],before[key],key);
    assert.match(comment.text,message);
    assert.match(comment.text,/accept responsibility again/);
    assert.equal(comment.actor,'jack');
    assert.equal(task(reload(store.exportState()),id).acceptedAt,'');
    assert.equal(GatherScheduleUI.reviewItems(store.getState(),now,{mine:true,actor:'maya'}).find(group=>group.key==='schedule-reconfirmation').tasks.some(t=>t.id===id),true);
    store.setNextUp(id,{enabled:true},'maya');
    before=task(store,id);
    assert.ok(before.acceptedAt&&before.nextUpAt);
  };
  check({...slot,location:'West entrance'},/Activity time or location changed/);
  check(null,/Activity removed from the schedule/);
  check(slot,/Activity added to the schedule/);
});

test('legacy workspaces stay unscheduled; malformed schedules are not silently overwritten',()=>{
  const state=JSON.parse(create().exportState());delete state.event.timeZone;state.tasks.forEach(t=>delete t.schedule);
  const old=reload(JSON.stringify(state));assert.equal(old.getState().persistence,'saved');
  assert.ok(old.getState().tasks.every(t=>t.schedule===null));assert.equal(old.getState().event.timeZone,'');
  for(const schedule of [{...slot,start:'2026-02-30T10:00'},slot,[],{...slot,actor:'jack'}]){
    const data=structuredClone(state);data.tasks[0].schedule=schedule;
    const raw=JSON.stringify(data);let writes=0;
    const store=GatherStore.createStore({storage:{getItem:()=>raw,setItem(){writes++;}}});
    assert.equal(store.getState().persistence,'unavailable');assert.equal(writes,0);
  }
});

test('schedule rejects malformed values and unauthorized edits atomically',()=>{
  const store=create(),before=store.exportState();
  for(const data of [undefined,[],{},'tomorrow',{...slot,start:'2026-02-29T10:00'},{...slot,start:'2026-10-03T24:00'},
    {...slot,start:'2026-10-03T09:30Z'},{...slot,end:slot.start},{...slot,end:'2026-10-02T12:00'},
    {...slot,start:'0000-10-03T09:30'},{...slot,location:'x'.repeat(241)},{...slot,owner:'dev'}, {...slot,end:null}]){
    assert.throws(()=>store.setTaskSchedule('dietary',data));assert.equal(store.exportState(),before);
  }
  for(const actor of ['maya','outsider']){assert.throws(()=>store.setTaskSchedule('dietary',slot,actor));assert.equal(store.exportState(),before);}
  assert.throws(()=>store.setTaskSchedule('missing',slot));assert.equal(store.exportState(),before);
  assert.throws(()=>store.addTask({title:'Invalid activity',schedule:{...slot,end:slot.start}}));assert.equal(store.exportState(),before);
  const fresh=GatherStore.createStore({storage:null,now}),raw=fresh.exportState();
  assert.throws(()=>fresh.addTask({title:'No time zone',schedule:slot}),/time zone/);assert.equal(fresh.exportState(),raw);
});

test('new and changed schedule boundaries must occur once in the event zone',()=>{
  const store=create(), before=store.exportState();
  for(const [start,end,error] of [
    ['2026-03-08T02:15','2026-03-08T03:15',/Start time .*does not exist in America\/Los_Angeles/],
    ['2026-03-08T01:15','2026-03-08T02:15',/End time .*does not exist in America\/Los_Angeles/],
    ['2026-11-01T01:15','2026-11-01T02:15',/Start time .*occurs twice in America\/Los_Angeles/],
    ['2026-11-01T00:15','2026-11-01T01:15',/End time .*occurs twice in America\/Los_Angeles/],
  ]){
    const schedule={start,end,location:''};
    assert.throws(()=>store.setTaskSchedule('dietary',schedule),error);
    assert.throws(()=>store.addTask({title:'Do not save',schedule}),error);
    assert.equal(store.exportState(),before);
  }
  const crossing={start:'2026-03-08T01:45',end:'2026-03-08T03:15',location:''};
  assert.deepEqual(store.setTaskSchedule('dietary',crossing).schedule,crossing);
});

test('older saved times stay editable and visible with a warning, without live clock cues',()=>{
  const raw=JSON.parse(create().exportState()), existing=raw.tasks.find(item=>item.id==='dietary');
  const schedule={start:'2026-11-01T01:15',end:'2026-11-01T02:15',location:'East'};
  existing.schedule=schedule;
  const store=reload(JSON.stringify(raw));
  assert.equal(store.getState().persistence,'saved');
  assert.deepEqual(task(store).schedule,schedule);
  const edited=store.setTaskSchedule('dietary',{...schedule,location:'West'});
  assert.equal(edited.schedule.location,'West');
  store.addTask({title:'Valid overlapping wall labels',owner:edited.owner,
    schedule:{start:'2026-11-01T00:45',end:'2026-11-01T02:30',location:'West'}});
  const current=store.getState(), now='2026-11-01T08:30:00Z';
  assert.equal(GatherScheduleUI.timing(current.tasks,current.event.timeZone,now).labels.has('dietary'),false);
  assert.deepEqual(GatherScheduleUI.reviewItems(current,now).find(group=>group.key==='clock-times').tasks.map(t=>t.id),['dietary']);
  const ui=GatherScheduleUI.create({h:String,options:()=>'',statusBadge:String});
  assert.match(ui.view(current,true,now),/Start time .*occurs twice/);
  assert.match(ui.details(edited,true,current.event),/Start time .*occurs twice/);
  const sheet=ui.runSheetModel(current,now);
  assert.match(ui.runSheetMarkup(sheet),/Start time .*occurs twice/);
  assert.match(ui.runSheetText(sheet),/Start time .*occurs twice/);
  assert.doesNotMatch(ui.runSheetText(sheet),/Owner overlap|Potential location overlap/);
  const guest=GatherScheduleUI.guestAgendaSnapshot(current);
  assert.equal(guest.invalidTimes,1);
  assert.deepEqual(guest.activities.map(item=>item.title),['Valid overlapping wall labels']);
  const corrected=store.setTaskSchedule('dietary',{...edited.schedule,start:'2026-11-01T00:45'});
  assert.equal(corrected.schedule.start,'2026-11-01T00:45');
  assert.equal(GatherScheduleUI.timing(store.getState().tasks,current.event.timeZone,now).labels.get('dietary'),'Scheduled now');
});

test('changing the event zone cannot introduce ambiguous or missing schedule times',()=>{
  const store=create();store.completeSetup({timeZone:'UTC'});
  store.addTask({title:'Fictional early activity',schedule:{start:'2026-03-08T02:15',end:'',location:''}});
  const before=store.exportState();
  assert.throws(()=>store.updateEvent({timeZone:'America/Los_Angeles',confirmScheduleTimeZone:true}),/Fictional early activity.*does not exist/);
  assert.equal(store.exportState(),before);
  assert.equal(store.updateEvent({timeZone:'Asia/Kolkata',confirmScheduleTimeZone:true}).timeZone,'Asia/Kolkata');
});

test('multi-day and overnight activities keep explicit dates; zone changes require acknowledgment',()=>{
  const store=create(),overnight={start:'2026-10-03T23:30',end:'2026-10-04T01:00',location:''};
  const activity=store.addTask({title:'Overnight travel',owner:'jules',schedule:overnight});
  assert.equal(activity.dueDate,'');assert.deepEqual(activity.schedule,overnight);
  store.setTaskSchedule('dietary',{...slot,start:'2026-10-05T09:30',end:''});
  const before=store.getState().tasks;
  store.completeSetup({date:'2026-10-06'});assert.deepEqual(store.getState().tasks,before);
  const raw=store.exportState();
  for(const input of [{timeZone:'Mars/Olympus'},{timeZone:''},{timeZone:'Europe/London'},{timeZone:'Europe/London',confirmScheduleTimeZone:'yes'}]){
    assert.throws(()=>store.completeSetup(input));assert.equal(store.exportState(),raw);
  }
  store.completeSetup({timeZone:'Europe/London',confirmScheduleTimeZone:true});
  assert.equal(store.getState().event.timeZone,'Europe/London');assert.deepEqual(store.getState().tasks,before);
  assert.equal(store.getState().event.confirmScheduleTimeZone,undefined);
});

const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui=GatherScheduleUI.create({h,options:items=>items.map(([value,label])=>`<option value="${h(value)}">${h(label)}</option>`).join(''),person:id=>h(id),statusBadge:status=>h(status)});
test('organizer schedule forms disclose the reconfirmation consequence before saving',()=>{
  const store=create();
  const {id}=store.addTask({title:'Check welcome hall',owner:'maya',schedule:{...slot,end:''}});
  store.acceptTask(id,'maya');
  const state=store.getState(),current=task(store,id);
  assert.match(ui.details(current,true,state.event),/clears the current acceptance and Next up commitment/);
  assert.match(ui.activityReviewForm(state,id),/same owner can accept again/);
  assert.match(ui.picker(state),/resets any existing acceptance/);
  assert.doesNotMatch(ui.details(current,false,state.event),/clears the current acceptance/);
  assert.doesNotMatch(ui.details({...current,reportedAt:'reported'},true,state.event),/clears the current acceptance/);
});
test('manual activities can be created without a time zone or date and keep their identity after scheduling',()=>{
  const store=GatherStore.createStore({storage:null,now});
  const form=ui.newActivity(store.getState());
  assert.match(form,/Activity name/);assert.match(form,/set its start time later/);assert.doesNotMatch(form,/name="start"/);
  const create=GatherScheduleUI.newActivityTask;
  const data={title:'Guest arrivals',owner:'maya',note:'Open the east doors.'};
  const activity=store.addTask(create(data));
  assert.deepEqual([activity.schedule,activity.eventActivity,activity.owner,activity.note,activity.status],[null,true,'maya',data.note,'todo']);
  assert.equal(task(reload(store.exportState()),activity.id).eventActivity,true);
  store.completeSetup({timeZone:'America/Los_Angeles',membersCanCreateTasks:true});
  assert.match(ui.newActivity(store.getState()),/Starts \(optional\)<input name="start" type="datetime-local" step=/);
  assert.match(ui.picker(store.getState(),activity.id),/name="start" type="datetime-local" required/);
  for(const partial of [{end:slot.end},{location:slot.location}])assert.throws(()=>create({...data,...partial}),/Enter a start time/);
  const timed=store.addTask(create({...data,title:'Main programme',...slot}));
  assert.deepEqual(timed.schedule,slot);assert.equal(timed.eventActivity,true);
  store.setTaskSchedule(timed.id,null);
  assert.equal(task(store,timed.id).eventActivity,true);assert.equal(task(store,timed.id).status,'todo');
  const before=store.exportState();
  assert.throws(()=>store.addTask(create(data),'maya'),/Teammates can add a task name/);
  assert.equal(store.exportState(),before);
});

test('schedule uses the same tasks, includes completed/verification rows, and escapes user content',()=>{
  const store=create();store.setTaskSchedule('venue',slot);store.setTaskSchedule('dietary',slot);
  store.updateTask('dietary',{requiresVerification:true});store.reportCompletion('dietary','Ready','maya');
  store.addTask({title:'<script>attack</script>',schedule:{...slot,start:'2026-10-04T09:30',end:'',location:'<img src=x onerror=alert(1)>'}});
  const state=store.getState(),html=ui.view(state,false);
  assert.match(html,/data-id="venue"/);assert.match(html,/Awaiting verification/);
  assert.match(html,/America\/Los_Angeles/);assert.match(html,/2026/);
  assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(ui.details(task(store),false,state.event),/<form|name="(?:start|end|location)"/);
  assert.match(ui.details(task(store),true,state.event),/id="scheduleForm"/);
  const form=ui.details(task(store),true,state.event);
  assert.ok(form.indexOf('value="save"')<form.indexOf('value="remove"'),'Enter saves instead of removing');
  const first=GatherScheduleUI.ordered(state.tasks).map(t=>t.id),second=GatherScheduleUI.ordered([...state.tasks].reverse()).map(t=>t.id);
  assert.deepEqual(first,second);assert.ok(html.indexOf('data-id="dietary"')<html.indexOf('data-id="venue"'));
  const before=GatherScheduleUI.range(slot),zone=process.env.TZ;
  try{process.env.TZ='Pacific/Auckland';assert.equal(GatherScheduleUI.range(slot),before);}finally{if(zone===undefined)delete process.env.TZ;else process.env.TZ=zone;}
});

test('hosted schedule save awaits success and keeps the draft intact on failure',async()=>{
  execFileSync(process.execPath,['scripts/prepare.mjs']);
  const source=readFileSync('public/gather-assets/app.js','utf8');
  assert.match(source,/await store\.setTaskSchedule\(/);
  assert.match(readFileSync('public/workspace.html','utf8'),/\/gather-assets\/versioned\/[a-f0-9]{20}-schedule-ui\.js/);
  const submitSource=source.slice(source.indexOf("  document.addEventListener('submit'"),source.indexOf("  document.addEventListener('change'"));
  for(const id of ['scheduleForm','schedulePickerForm','newTaskForm']){
    let submit,reject,locked=false;const events=[];
    const pending=new Promise((_resolve,no)=>{reject=no;});
    const fields={...slot,taskId:'dietary',title:'Activity'};
    const form={id,dataset:{id:'dietary',scheduled:'true'},isConnected:true,closest(){return this;}};
    const context=vm.createContext({document:{addEventListener:(_type,handler)=>{submit=handler;}},ui:{actor:'jack'},GatherScheduleUI,
      FormData:class {constructor(){return Object.entries(fields);}},$:()=>null,
      saveLock:()=>{locked=true;return()=>{locked=false;}},store:{getState:()=>({tasks:[]}),setTaskSchedule:()=>pending,addTask:()=>pending},
      formError:(_form,error)=>events.push('error:'+error.message),toast:text=>events.push(text),
      render:()=>events.push('render'),closeDialog:()=>events.push('close'),taskDialog:()=>events.push('task')});
    vm.runInContext(submitSource,context);
    const result=submit({target:form,preventDefault(){},submitter:{value:'save'}});
    await Promise.resolve();assert.equal(locked,true);assert.deepEqual(events,[]);
    reject(new Error('Could not save'));await result;
    assert.equal(locked,false);assert.equal(form.isConnected,true);assert.deepEqual(fields,{...slot,taskId:'dietary',title:'Activity'});
    assert.deepEqual(events,['error:Could not save','Could not save']);
  }
});

test('the hosted submit dispatcher awaits the reviewed schedule save without a second generic write',async()=>{
  execFileSync(process.execPath,['scripts/prepare.mjs']);
  const app=readFileSync('public/gather-assets/app.js','utf8');
  const start=app.indexOf("      if(form.id==='reviewScheduleForm')");
  const fragment=app.slice(start,app.indexOf("      if(form.id==='taskDetailForm')",start));
  const events=[];
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  const form={id:'reviewScheduleForm',dataset:{id:'fixed',revision:'3'}},data={...slot,taskId:'other'};
  const context=vm.createContext({form,data,events,saveEventReviewSchedule(form,data){
    events.push(['save',form,data]);return pending;
  }});
  const result=vm.runInContext(`(async()=>{${fragment};events.push('continued')})()`,context);
  assert.deepEqual(events,[['save',form,data]]);
  release();await result;
  assert.equal(events[1],'continued');
});
