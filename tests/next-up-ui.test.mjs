import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/priorities.js';
import '../legacy/recovery-ui.js';

const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const task=(id,extra={})=>({id,title:id,owner:'maya',status:'todo',dueDate:'',dependencies:[],...extra});
const state=tasks=>({tasks,event:{timeZone:'America/Los_Angeles'},members:[]});
const panel=(s,actor='maya',overview=false)=>GatherRecoveryUI.create({store:{getState:()=>s},ui:{actor},h,options:()=>'',dayLabel:h,member:id=>({name:id})}).nextUpPanel(s,{overview});
const suggestions=html=>{
  const section=html.match(/<details data-next-up-suggestions [^>]*class="next-up-suggestions"[^>]*>([\s\S]*?)<\/details>/)?.[1]||'';
  return [...section.matchAll(/<article>[\s\S]*?data-id="([^"]+)"[\s\S]*?<\/article>/g)]
    .map(([markup,id])=>({id,markup}));
};

test('empty Next up exposes up to three ranked ready tasks but never commits or assigns them',()=>{
  const tasks=[task('later',{dueDate:'2099-10-03'}),task('important',{priority:'high'}),task('third'),task('fourth'),
    task('other',{owner:'jules',priority:'high'}),task('blocked',{status:'blocked'}),task('complete',{status:'done'})];
  const s=state(tasks),before=structuredClone(s),html=panel(s);
  const expected=GatherPriorities.rank(tasks,new Date(),true,s.event.timeZone).filter(t=>t.owner==='maya'&&GatherPriorities.actionable(t,tasks)).slice(0,3);
  assert.match(html,/class="next-up-suggestions" open/);assert.match(html,/Choose up to three tasks/);
  assert.deepEqual([...html.matchAll(/data-id="([^"]+)"/g)].map(m=>m[1]),expected.map(t=>t.id));
  assert.doesNotMatch(html,/data-action="(?:claim|accept-task|toggle-task)"|<form/);assert.deepEqual(s,before);
});

test('existing commitments stay prominent, suggestions use only remaining slots, and full panels hide them',()=>{
  const tasks=Array.from({length:5},(_,i)=>task('task'+i)),s=state(tasks);
  tasks[0].nextUpAt='2026-10-01T12:00:00Z';
  let html=panel(s);assert.match(html,/1\/3/);assert.match(html,/class="next-up-suggestions"><summary data-next-up-origin="summary"/);
  assert.doesNotMatch(html,/next-up-suggestions" open|Choose up to/);
  assert.equal([...html.matchAll(/data-id=/g)].length,3);
  tasks[1].nextUpAt=tasks[0].nextUpAt;tasks[2].nextUpAt=tasks[0].nextUpAt;
  html=panel(s);assert.match(html,/3\/3/);assert.doesNotMatch(html,/Suggested next tasks/);
});

test('Next up identifies its origin and explains when a commitment also accepts responsibility',()=>{
  const store=GatherStore.createStore({storage:null});
  const created=store.addTask({title:'Fictional commitments task',owner:'maya'});
  const recovery=GatherRecoveryUI.create({store,ui:{actor:'maya'},h,options:()=>'',dayLabel:h,member:id=>({name:id})});
  const current=()=>store.getState().tasks.find(row=>row.id===created.id);
  const control=()=>recovery.responseMarkup(current(),false);
  assert.match(control(),/id="nextUpTaskState" tabindex="-1">Not committed to Next up/);
  assert.match(control(),/Committing also accepts responsibility for this task/);
  store.setNextUp(created.id,{enabled:true},'maya');
  assert.match(control(),/id="nextUpTaskState" tabindex="-1">Committed to Next up/);
  assert.doesNotMatch(control(),/also accepts responsibility/);
  assert.match(panel(store.getState()),/data-next-up-panel="mine" data-next-up-actor="maya"/);
  assert.match(panel(store.getState(),'maya',true),/data-next-up-panel="overview" data-next-up-actor="maya"/);
  assert.match(panel(store.getState()),new RegExp(`data-next-up-origin="task" data-id="${created.id}"`));
  store.setNextUp(created.id,{enabled:false},'maya');
  assert.match(control(),/Not committed to Next up/);
  assert.doesNotMatch(control(),/also accepts responsibility/);
  assert.ok(current().acceptedAt);
});

test('hosted Next up confirms and focuses the new state only after the save resolves',async()=>{
  const app=readFileSync('public/gather-assets/app.js','utf8');
  const start=app.indexOf("      if(form.id==='nextUpForm'){");
  const end=app.indexOf("      if(form.id==='recoveryDecisionForm')",start);
  assert.ok(start>=0&&end>start);
  const events=[],frames=[];
  let resolve,reject;
  const ui={actor:'maya',dialogKind:'task',detailId:'task-a'};
  const backdrop={hidden:false};
  const ctx=vm.createContext({
    form:{id:'nextUpForm',dataset:{id:'task-a'}},data:{enabled:'true',replaceTaskId:'task-b'},ui,window:{},
    store:{getState:()=>({tasks:[{id:'task-a',acceptedAt:''}]}),setNextUp:(id,data,actor)=>{
      events.push(['save',id,data.enabled,data.replaceTaskId,actor]);
      return new Promise((yes,no)=>{resolve=yes;reject=no;});
    }},
    render:()=>events.push('render'),taskDialog:(...args)=>events.push(['dialog',...args]),toast:value=>events.push(value),
    requestAnimationFrame:callback=>frames.push(callback),
    $:selector=>selector==='#dialogBackdrop'?backdrop:selector==='#nextUpTaskState'?{focus:()=>events.push('focus-state')}:{},
  });
  const run=()=>vm.runInContext('(async()=>{'+app.slice(start,end)+'})()',ctx);
  let pending=run();
  assert.deepEqual(events,[['save','task-a',true,'task-b','maya']]);
  assert.equal(frames.length,0);
  resolve();
  await pending;
  assert.deepEqual(events.slice(1),['render',['dialog','task-a','nextUpForm'],'Task swapped into Next up. Responsibility accepted.']);
  frames.shift()();
  assert.equal(events.at(-1),'focus-state');

  events.length=0;
  pending=run();
  reject(new Error('Fictional failed save'));
  await assert.rejects(pending,/Fictional failed save/);
  assert.deepEqual(events,[['save','task-a',true,'task-b','maya']]);
  assert.equal(frames.length,0);
});

test('accepting an assignment keeps it visible among equally urgent suggestions without committing it',()=>{
  const realNow=Date.now();
  let clock=realNow-4*86400000;
  const store=GatherStore.createStore({storage:null,now:()=>clock});
  const peers=Array.from({length:4},(_,index)=>store.addTask({title:`Fictional assignment ${index+1}`,owner:'maya'}));
  const urgent=store.addTask({title:'Fictional high priority assignment',owner:'maya'});
  store.setTaskPriority(urgent.id,{priority:'high'});
  const blocked=store.addTask({title:'Fictional blocked assignment',owner:'maya',status:'blocked'});
  const awaiting=store.addTask({title:'Fictional reported assignment',owner:'maya',requiresVerification:true});
  store.reportCompletion(awaiting.id,'Fictional result ready to review.','maya');
  const other=store.addTask({title:'Fictional different owner',owner:'dev'});
  const waiting=store.addTask({title:'Fictional pending linked work',owner:'maya',dependencies:[{taskId:other.id,kind:'dependency',reason:'Wait for the other task result.'}]});
  const help=store.addTask({title:'Fictional assignment needs help',owner:'maya'});
  store.requestRecovery(help.id,{kind:'help',note:'Fictional help request.'},'maya');
  const excluded=[blocked,awaiting,other,waiting,help];
  for(const task of excluded)store.setTaskPriority(task.id,{priority:'high'});
  const visible=new Set([...peers,urgent,...excluded].map(task=>task.id));
  const view=()=>{const s=store.getState();return {...s,tasks:s.tasks.filter(task=>visible.has(task.id))};};
  const initial=suggestions(panel(view()));
  const picked=peers.find(task=>task.id===initial[1]?.id);
  assert.equal(initial[0]?.id,urgent.id);
  assert.ok(picked,'choose an ordinary task already visible in the suggestions');
  clock=realNow;
  store.acceptTasks([{id:picked.id,revision:picked.revision}],'maya');
  const before=store.exportState(),current=view();
  for(const overview of [false,true]){
    const html=panel(current,'maya',overview),rows=suggestions(html);
    assert.equal(rows.length,3);
    assert.deepEqual(rows.slice(0,2).map(row=>row.id),[urgent.id,picked.id]);
    assert.match(rows[0].markup,/Review assignment/);
    assert.match(rows[1].markup,/Accepted · Not committed/);
    assert.ok(peers.some(task=>task.id===rows[2].id&&task.id!==picked.id));
    assert.match(rows[2].markup,/Review assignment/);
    for(const task of excluded)assert.ok(!rows.some(row=>row.id===task.id));
    assert.match(html,/0\/3/);
    assert.doesNotMatch(html,/<form|data-action="(?:claim|accept-task|toggle-task)"/);
  }
  const accepted=current.tasks.find(task=>task.id===picked.id);
  assert.ok(accepted.acceptedAt);
  assert.equal(accepted.nextUpAt,'');
  assert.equal(accepted.status,'todo');
  assert.equal(store.exportState(),before);
  const organizerRank=GatherPriorities.rank(current.tasks,new Date(),true,current.event.timeZone).map(task=>task.id);
  assert.ok(peers.filter(task=>task.id!==picked.id).every(task=>organizerRank.indexOf(task.id)<organizerRank.indexOf(picked.id)),
    'the organizer still sees pending acceptance as an attention signal');
});

test('empty guidance distinguishes no assignments from blocked, dependent, and verification-only work',()=>{
  for(const tasks of [[],[task('done',{status:'done'}),task('other',{owner:'jules'})]]){
    const html=panel(state(tasks));assert.match(html,/No open tasks assigned to you/);assert.doesNotMatch(html,/Choose up to|Suggested next/);
  }
  for(const item of [task('blocked',{status:'blocked'}),task('dependent',{dependencies:[{taskId:'missing'}]}),
    task('reported',{requiresVerification:true,reportedAt:'2026-10-01T12:00:00Z'}),
    task('help',{recoveryRequests:[{kind:'help',status:'pending'}]})]){
    const html=panel(state([item]));assert.match(html,/Nothing ready to start/);assert.doesNotMatch(html,/Choose up to|Suggested next/);
  }
});

test('pending help and date requests stay visible without taking commitment slots or duplicating tasks',()=>{
  const store=GatherStore.createStore({storage:null});
  const [help,date,other]=['Fictional help task','Fictional date task','Fictional other owner'].map((title,i)=>store.addTask({title,owner:i===2?'dev':'maya'}));
  store.setNextUp(help.id,{enabled:true},'maya');
  store.setNextUp(date.id,{enabled:true},'maya');
  store.requestRecovery(help.id,{kind:'help',note:'Fictional help note'},'maya');
  store.requestRecovery(date.id,{kind:'date',note:'Fictional date note',proposedDate:'2099-11-04'},'maya');
  store.requestRecovery(other.id,{kind:'help',note:'Fictional other note'},'dev');
  const view=()=>{const s=store.getState();return {...s,tasks:s.tasks.filter(task=>[help.id,date.id,other.id].includes(task.id))};};
  const before=store.exportState();
  for(const overview of [false,true]){
    const html=panel(view(),'maya',overview);
    assert.match(html,/1\/3/);
    assert.match(html,/Waiting for the organizer[\s\S]*Fictional help task[\s\S]*Help request awaiting review/);
    assert.match(html,/Fictional date task[\s\S]*Date proposal awaiting review/);
    for(const {id} of [help,date])assert.equal(html.split('data-open-recovery data-id="'+id+'"').length,2);
    assert.doesNotMatch(html,/Fictional .* note|Fictional other owner/);
  }
  assert.equal(store.exportState(),before);
  store.setNextUp(date.id,{enabled:false},'maya');
  const uncommitted=panel(view());
  assert.match(uncommitted,/0\/3/);
  assert.match(uncommitted,/Waiting for the organizer[\s\S]*Fictional date task/);
  assert.equal(uncommitted.split('data-open-recovery data-id="'+date.id+'"').length,2);
  assert.doesNotMatch(uncommitted,/Suggested next tasks/);
});

test('suggested task text is escaped, actor-scoped, and committing continues through the existing owner action',()=>{
  const s=state([task('id"<>',{title:'<img src=x onerror=alert(1)>'})]);
  const html=panel(s);assert.match(html,/data-id="id&quot;&lt;&gt;"/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);
  assert.doesNotMatch(panel(s,'jules'),/id&quot;/);
  const store=GatherStore.createStore({storage:null});const created=store.addTask({title:'Ready to start',owner:'maya'}),raw=store.exportState();
  panel(store.getState());assert.equal(store.exportState(),raw);
  store.setNextUp(created.id,{enabled:true},'maya');const committed=store.getState().tasks.find(t=>t.id===created.id);
  assert.ok(committed.nextUpAt);assert.ok(committed.acceptedAt);assert.equal(committed.status,'todo');
  assert.match(panel(store.getState()),/1\/3/);
});

test('reassignment advice excludes inactive teammates without erasing their historical workload',()=>{
  const current=task('help',{recoveryRequests:[{kind:'help',status:'pending'}]}),historic=task('former-work',{owner:'former',status:'done'});
  const busy=task('dev-work',{owner:'dev',nextUpAt:'2026-10-01T12:00:00Z'});
  const s={...state([current,historic,busy]),members:[{id:'maya',name:'Maya'},{id:'former',name:'Former teammate',active:false},{id:'dev',name:'Dev Kim',active:true}]};
  const before=structuredClone(s);assert.match(GatherPriorities.suggestion(current,s).text,/Consider Dev/);assert.deepEqual(s,before);
  s.members.find(m=>m.id==='dev').active=false;
  assert.doesNotMatch(GatherPriorities.suggestion(current,s).text,/Consider (?:Former|Dev|Maya)/);
  s.members.push({id:'legacy',name:'Legacy active member'});
  assert.match(GatherPriorities.suggestion(current,s).text,/Consider Legacy/);
});

test('Overview next steps are personal, read-only and link to My tasks without accepting work',()=>{
  const s=state([task('mine',{title:'Review the planning brief'}),task('other',{owner:'jules'}),task('waiting',{dependencies:[{taskId:'missing'}]})]);
  const before=structuredClone(s),recovery=GatherRecoveryUI.create({store:{getState:()=>s},ui:{actor:'maya'},h,options:()=>'',dayLabel:h,member:id=>({name:id})});
  const html=recovery.nextUpPanel(s,{overview:true});
  assert.match(html,/aria-label="Your next steps"/);assert.match(html,/Your next steps/);
  assert.match(html,/0\/3 committed/);assert.match(html,/Review a task to accept responsibility/);
  assert.match(html,/data-action="task-filter" data-filter="mine"[^>]*>View my tasks/);
  assert.match(html,/data-id="mine"/);assert.doesNotMatch(html,/data-id="other"|data-id="waiting"|<form|data-action="accept-task"/);
  assert.deepEqual(s,before);
  assert.doesNotMatch(recovery.nextUpPanel(s),/Your next steps|View my tasks|committed/);
});
