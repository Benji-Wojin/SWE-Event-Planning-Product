import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/priorities.js';
import '../legacy/recovery-ui.js';

const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const task=(id,extra={})=>({id,title:id,owner:'maya',status:'todo',dueDate:'',dependencies:[],...extra});
const state=tasks=>({tasks,event:{timeZone:'America/Los_Angeles'},members:[]});
const panel=(s,actor='maya')=>GatherRecoveryUI.create({store:{getState:()=>s},ui:{actor},h,options:()=>'',dayLabel:h,member:id=>({name:id})}).nextUpPanel(s);

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
  let html=panel(s);assert.match(html,/1\/3/);assert.match(html,/class="next-up-suggestions"><summary/);
  assert.doesNotMatch(html,/next-up-suggestions" open|Choose up to/);
  assert.equal([...html.matchAll(/data-id=/g)].length,3);
  tasks[1].nextUpAt=tasks[0].nextUpAt;tasks[2].nextUpAt=tasks[0].nextUpAt;
  html=panel(s);assert.match(html,/3\/3/);assert.doesNotMatch(html,/Suggested next tasks/);
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
