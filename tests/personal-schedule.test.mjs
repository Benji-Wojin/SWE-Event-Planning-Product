import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/schedule-ui.js';

const now='2026-10-03T16:30:00Z',event={timeZone:'America/Los_Angeles'};
const task=(id,owner,start='09:00',end='10:00',extra={})=>({id,title:id,owner,status:'todo',schedule:{start:'2026-10-03T'+start,end:'2026-10-03T'+end,location:'Main hall'},...extra});
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const schedule=GatherScheduleUI.create({h,options:()=>'',person:id=>'<span class="person-chip">'+h(id||'Unassigned')+'</span>',statusBadge:status=>'<span class="status-badge">'+h(status)+'</span>'});
const ids=html=>[...html.matchAll(/data-action="task" data-id="([^"]+)"/g)].map(match=>match[1]);

test('personal schedule filters timetable and current/next cues without changing task data',()=>{
  const state={event,tasks:[task('mine-now','maya'),task('other-now','dev'),task('unassigned',''),task('other-next','dev','10:00','10:30'),task('mine-next','maya','11:00','12:00')]};
  const before=structuredClone(state),scope={mine:true,actor:'maya'};
  const html=schedule.view(state,false,now,scope),clock=schedule.clock(state,now,scope);
  assert.deepEqual(ids(clock.markup),['mine-now','mine-next']);
  assert.deepEqual([...clock.labels.keys()],['mine-now','mine-next']);
  assert.deepEqual([...new Set(ids(html))],['mine-now','mine-next']);
  assert.match(html,/aria-pressed="true" data-action="schedule-scope" data-id="mine"/);
  assert.deepEqual(new Set(ids(schedule.view(state,false,now))),new Set(state.tasks.map(t=>t.id)));
  assert.deepEqual(state,before);assert.doesNotMatch(html,/<form|data-action="(?:claim|toggle-task)"/);
});

test('empty personal schedules are truthful and offer a return to all activities',()=>{
  const state={event,tasks:[task('other','dev'),task('unassigned','')]};
  for(const actor of ['maya','',undefined]){
    const html=schedule.view(state,false,now,{mine:true,actor});
    assert.match(html,/No activities assigned to you/);assert.match(html,/Show all activities/);
    assert.deepEqual(ids(html),[]);assert.equal(schedule.clock(state,now,{mine:true,actor}).markup,'');
  }
  for(const organizer of [true,false]){
    const html=schedule.view({event,tasks:[]},organizer,now,{mine:true,actor:'maya'});
    assert.match(html,/No scheduled activities/);assert.doesNotMatch(html,/No activities assigned|Activity scope/);
  }
});

test('personal schedules retain completed/review work and only their own overlap warnings',()=>{
  const tasks=[task('mine','maya'),task('done','maya','09:00','10:00',{status:'done'}),
    task('waiting','maya','11:00','12:00',{requiresVerification:true,reportedAt:now,status:'progress'}),
    task('other-a','dev'),task('other-b','dev')];
  let html=schedule.view({event,tasks},false,now,{mine:true,actor:'maya'});
  assert.deepEqual(new Set(ids(html)),new Set(['mine','done','waiting']));
  assert.match(html,/Awaiting verification/);assert.doesNotMatch(html,/activities have owner overlaps/);
  tasks.push(task('mine-overlap','maya','09:30','10:30'));
  html=schedule.view({event,tasks},false,now,{mine:true,actor:'maya'});
  assert.match(html,/2 activities have owner overlaps/);
  assert.equal((html.match(/>Owner overlap</g)||[]).length,2);
});

test('focus cards expose safe owner, location and status with no extra actions',()=>{
  const item=task('id"<>','<Maya>','09:00','10:00',{title:'<img src=x onerror=alert(1)>',status:'blocked'});
  item.schedule.location='<script>alert(1)</script>';
  const markup=schedule.clock({event,tasks:[item]},now).markup;
  assert.match(markup,/&lt;Maya&gt;/);assert.match(markup,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(markup,/status-badge">blocked/);assert.match(markup,/data-id="id&quot;&lt;&gt;"/);
  assert.doesNotMatch(markup,/<img|<script|<form/);assert.deepEqual(ids(markup),['id&quot;&lt;&gt;']);
});

test('saved ownership and completion changes immediately recompute a personal timetable',()=>{
  const store=GatherStore.createStore({storage:null});store.completeSetup(event);
  const item=store.addTask({title:'Welcome desk',owner:'maya',schedule:{start:'2026-10-03T09:00',end:'2026-10-03T10:00',location:'Entrance'}});
  const scope={mine:true,actor:'maya'};
  assert.deepEqual(ids(schedule.clock(store.getState(),now,scope).markup),[item.id]);
  store.updateTask(item.id,{owner:'dev'});
  assert.equal(schedule.clock(store.getState(),now,scope).markup,'');
  assert.match(schedule.view(store.getState(),false,now,scope),/No activities assigned/);
  store.updateTask(item.id,{owner:'maya'});store.reportCompletion(item.id,'Guests checked in.','maya');
  assert.deepEqual(ids(schedule.clock(store.getState(),now,scope).markup),[]);
  assert.deepEqual(ids(schedule.view(store.getState(),false,now,scope)),[item.id]);
});

test('timeline view and live refresh use the current profile and the same scope',()=>{
  const source=readFileSync('legacy/app.js','utf8');
  const start=source.indexOf('  function timelineView(s)');
  const fragment=source.slice(start,source.indexOf('  function updatesView(s)',start));
  const calls=[];
  const context=vm.createContext({ui:{timelineMode:'schedule',scheduleMine:true,actor:'maya'},isOrganizer:()=>false,
    pageHeading:()=>'',schedule:{view(state,organizer,now,scope){calls.push({state,organizer,scope});return 'timetable';}}});
  vm.runInContext(fragment+'globalThis.view=timelineView;',context);
  const state={tasks:[],event};assert.match(context.view(state),/timetable/);
  assert.deepEqual({...calls[0].scope},{mine:true,actor:'maya'});assert.equal(calls[0].state,state);
  context.ui.actor='dev';context.view(state);assert.equal(calls[1].scope.actor,'dev');
  context.ui.scheduleMine=false;context.view(state);assert.equal(calls[2].scope.mine,false);
  assert.match(source,/if\(action==='schedule-scope'\)\{ui\.scheduleMine=id==='mine';render\(\);\}/);
});
