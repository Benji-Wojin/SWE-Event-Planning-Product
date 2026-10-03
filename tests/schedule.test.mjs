import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import '../legacy/store.js';
import '../legacy/schedule-ui.js';

const now=Date.parse('2026-10-01T12:00:00Z');
const slot={start:'2026-10-03T09:30',end:'2026-10-03T10:00',location:'East entrance'};
const create=()=>{const store=GatherStore.createStore({storage:null,now});store.completeSetup({timeZone:'America/Los_Angeles'});return store;};
const task=(store,id='dietary')=>store.getState().tasks.find(task=>task.id===id);
const reload=raw=>GatherStore.createStore({storage:{getItem:key=>key===GatherStore.STORAGE_KEY?raw:null,setItem(){}}});

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
  assert.match(readFileSync('public/workspace.html','utf8'),/\/gather-assets\/schedule-ui\.js/);
  const submitSource=source.slice(source.indexOf("  document.addEventListener('submit'"),source.indexOf("  document.addEventListener('change'"));
  for(const id of ['scheduleForm','schedulePickerForm','newTaskForm']){
    let submit,reject,locked=false;const events=[];
    const pending=new Promise((_resolve,no)=>{reject=no;});
    const fields={...slot,taskId:'dietary',title:'Activity'};
    const form={id,dataset:{id:'dietary',scheduled:'true'},isConnected:true,closest(){return this;}};
    const context=vm.createContext({document:{addEventListener:(_type,handler)=>{submit=handler;}},ui:{actor:'jack'},
      FormData:class {constructor(){return Object.entries(fields);}},$:()=>null,
      saveLock:()=>{locked=true;return()=>{locked=false;}},store:{setTaskSchedule:()=>pending,addTask:()=>pending},
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
