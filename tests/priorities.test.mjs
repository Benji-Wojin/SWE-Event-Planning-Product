import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/store.js';
import '../legacy/priorities.js';

const now = new Date(2026,8,24,12);
const task = (id,patch={}) => ({id,title:id,owner:'maya',status:'progress',dueDate:'2026-10-15',acceptedAt:now.toISOString(),updatedAt:now.toISOString(),dependencies:[],priority:'auto',...patch});
const info = (item,tasks=[item]) => GatherPriorities.analyze(item,tasks,now);
const ranked = tasks => GatherPriorities.rank(tasks,now).map(t=>t.id);

test('overdue tasks always precede upcoming work; manual priorities reorder each group',()=>{
  const tasks=[task('urgent',{priority:'high'}),task('late-low',{dueDate:'2026-09-23',priority:'low'}),task('late-high',{dueDate:'2026-09-23',priority:'high'}),task('late-auto',{dueDate:'2026-09-23'}),task('today',{dueDate:'2026-09-24'}),task('today-low',{dueDate:'2026-09-24',priority:'low'})];
  assert.deepEqual(ranked(tasks),['late-high','late-auto','late-low','urgent','today','today-low']);
  const blocked=info(task('blocked',{dueDate:'2026-09-20',status:'blocked',owner:''}));
  assert.equal(blocked.overdue,true);
  for(const key of ['overdue','blocked','unassigned'])assert.ok(blocked.factors.some(f=>f.key===key));
});

test('automatic ranking promotes prerequisites and deadlines; related and completed links do not boost priority',()=>{
  const prerequisite=task('dietary'),parent=task('menu',{status:'blocked',dependencies:[{taskId:'dietary'}]}),today=task('today',{dueDate:'2026-09-24'});
  assert.deepEqual(ranked([today,parent,prerequisite]),['dietary','today','menu']);
  assert.equal(info(prerequisite,[prerequisite,{...parent,dependencies:[{taskId:'dietary',kind:'related'}]}]),null);
  assert.equal(info(prerequisite,[prerequisite,{...parent,status:'done'}]),null);
  assert.equal(info({...prerequisite,status:'done',priority:'high'}),null);
});

test('completed work disappears; pending verification and ready dependencies remain actionable',()=>{
  const done=task('dietary',{status:'done',requiresVerification:true,reportedAt:now.toISOString()});
  const parent=task('menu',{status:'blocked',dependencies:[{taskId:done.id}]});
  assert.ok(info(done).factors.some(f=>f.key==='verification'));
  assert.ok(!info(parent,[done,parent]).factors.some(f=>f.key==='ready'));
  const verified={...done,verifiedAt:now.toISOString()};
  assert.equal(info(verified),null);
  assert.ok(info(parent,[verified,parent]).factors.some(f=>f.key==='ready'));
});

test('follow-up scheduling suppresses routine reminders but not deadlines, blockers or manual high priority',()=>{
  const snoozed=task('later',{acceptedAt:'',updatedAt:'2026-09-01T12:00:00Z',followupAfter:'2026-10-01'});
  assert.equal(info(snoozed),null);
  assert.equal(info({...snoozed,dueDate:'2026-09-23'}).key,'overdue');
  assert.equal(info({...snoozed,status:'blocked'}).key,'blocked');
  assert.equal(info({...snoozed,priority:'high'}).key,'priority');
  assert.ok(info({...snoozed,followupAfter:'2026-09-24'}).factors.some(f=>f.key==='followup'));
});

test('calendar-day deadlines are stable across DST and equal ranks have deterministic ordering',()=>{
  const local=new Date(2026,2,9,0,1);
  assert.equal(GatherPriorities.analyze(task('dst',{dueDate:'2026-03-08'}),[],local).label,'1 day overdue');
  assert.equal(GatherPriorities.analyze(task('today',{dueDate:'2026-03-09'}),[],local).overdue,false);
  const a=task('a',{dueDate:'2026-09-24'}),b=task('b',{dueDate:'2026-09-24'});
  assert.deepEqual(ranked([b,a]),ranked([a,b]));
});

test('priority persists, is organizer-only, and never fabricates a progress update',()=>{
  const store=GatherStore.createStore({storage:null,now:now.getTime()});
  const original=store.getState().tasks.find(t=>t.id==='dietary');
  store.setTaskPriority('dietary','high','jack');
  const updated=store.getState().tasks.find(t=>t.id==='dietary');
  assert.deepEqual({...updated,priority:original.priority,revision:original.revision},original);
  assert.equal(updated.priority,'high');assert.equal(updated.revision,original.revision+1);
  const raw=store.exportState(),restored=GatherStore.createStore({storage:{getItem:()=>raw,setItem:()=>{}}});
  assert.equal(restored.getState().tasks.find(t=>t.id==='dietary').priority,'high');
  for(const [value,actor] of [['high','maya'],['urgent','jack'],[null,'jack']])assert.throws(()=>store.setTaskPriority('dietary',value,actor));
  assert.equal(store.exportState(),raw);
  store.setTaskPriority('dietary','auto','jack');assert.equal(store.getState().tasks.find(t=>t.id==='dietary').priority,'auto');
  const data=JSON.parse(raw);data.tasks.forEach(t=>delete t.priority);
  const migrated=GatherStore.createStore({storage:{getItem:()=>JSON.stringify(data),setItem:()=>{}}});
  assert.ok(migrated.getState().tasks.every(t=>t.priority==='auto'));
});

test('Needs attention filters and search preserve the shared dashboard ranking',()=>{
  const source=readFileSync('legacy/app.js','utf8');
  const s={tasks:[task('later',{priority:'high'}),task('late',{dueDate:'2026-09-21'}),task('today',{dueDate:'2026-09-24'})]};
  const context=vm.createContext({ui:{tab:'attention',actor:'jack',owner:'',status:'',search:''},store:{getState:()=>s},GatherPriorities:{rank:tasks=>GatherPriorities.rank(tasks,now),analyze:(t,tasks)=>GatherPriorities.analyze(t,tasks,now)},member:()=>({name:'Maya'})});
  vm.runInContext(source.slice(source.indexOf('  const reason ='),source.indexOf('  const pending ='))+source.slice(source.indexOf('  function filteredTasks('),source.indexOf('  const options ='))+'globalThis.attention=attention;',context);
  assert.deepEqual(Array.from(context.filteredTasks(s),t=>t.id),context.attention(s).map(t=>t.id));
  context.ui.search='late';assert.deepEqual(Array.from(context.filteredTasks(s),t=>t.id),['late','later']);
});
