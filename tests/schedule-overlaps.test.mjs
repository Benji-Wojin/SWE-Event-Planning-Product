import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/schedule-ui.js';

const activity=(id,start,end,owner='maya',extra={})=>({id,title:id,owner,status:'todo',schedule:{start,end,location:''},...extra});
const at=time=>'2026-10-03T'+time;
const pairs=tasks=>[...GatherScheduleUI.ownerOverlaps(tasks)].map(([id,others])=>[id,others.map(t=>t.id).sort()]).sort(([a],[b])=>a.localeCompare(b));
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui=GatherScheduleUI.create({h:escape,options:()=>'',person:escape,statusBadge:escape});
const event={timeZone:'America/Los_Angeles'};

test('owner overlaps are symmetric, deterministic and include nested windows without mutating tasks',()=>{
  const tasks=[activity('a',at('09:00'),at('12:00')),activity('b',at('10:00'),at('11:00')),activity('c',at('10:30'),at('11:30'))];
  const before=structuredClone(tasks);
  assert.deepEqual(pairs(tasks),[['a',['b','c']],['b',['a','c']],['c',['a','b']]]);
  assert.deepEqual(pairs([...tasks].reverse()),pairs(tasks));assert.deepEqual(tasks,before);
});

test('touching endpoints, different owners, unassigned activities and resolved work do not warn',()=>{
  const first=activity('a',at('09:00'),at('10:00'));
  for(const second of [activity('b',at('10:00'),at('11:00')),activity('b',at('09:00'),at('10:00'),'jules'),
    activity('b',at('09:00'),at('10:00'),''),activity('b',at('09:00'),at('10:00'),'maya',{status:'done'}),
    activity('b',at('09:00'),at('10:00'),'maya',{status:'done',requiresVerification:true,verifiedAt:'2026-10-03T17:00:00Z'})]) {
    assert.deepEqual(pairs([first,second]),[]);
  }
  assert.deepEqual(pairs([{...first,owner:''},activity('b',at('09:00'),at('10:00'),'')]),[]);
  assert.deepEqual(pairs([first,{id:'unscheduled',owner:'maya',status:'todo'}]),[]);
  for(const status of ['blocked','progress','done']) {
    assert.equal(pairs([first,activity('b',at('09:00'),at('10:00'),'maya',{status,requiresVerification:true,reportedAt:'2026-10-03T16:30:00Z',verifiedAt:''})]).length,2);
  }
});

test('missing ends are not invented: simultaneous starts and starts inside a known window warn',()=>{
  const point=activity('point',at('09:30'),'');
  assert.equal(pairs([point,activity('other',at('09:30'),'')]).length,2);
  assert.equal(pairs([point,activity('window',at('09:00'),at('10:00'))]).length,2);
  assert.deepEqual(pairs([point,activity('later',at('10:00'),at('11:00'))]),[]);
  assert.deepEqual(pairs([point,activity('ending',at('09:00'),at('09:30'))]),[]);
  assert.equal(pairs([point,activity('same',at('09:30'),at('10:00'))]).length,2);
});

test('overnight overlaps use explicit event-local dates independent of viewer time zone',()=>{
  const tasks=[activity('overnight','2026-10-03T23:00','2026-10-04T01:00'),
    activity('morning','2026-10-04T00:30','2026-10-04T01:30'),activity('next-day','2026-10-05T00:30','2026-10-05T01:30')];
  const expected=[['morning',['overnight']],['overnight',['morning']]],before=process.env.TZ;
  try {
    for(const zone of ['UTC','America/Los_Angeles','Asia/Tokyo','Pacific/Auckland']) {
      process.env.TZ=zone;assert.deepEqual(pairs(tasks),expected);
    }
  } finally { if(before===undefined)delete process.env.TZ;else process.env.TZ=before; }
});

test('timeline and details show a concise warning with escaped links, not extra edit permission',()=>{
  const tasks=[activity('a',at('09:00'),at('10:00')),activity('b"<>',at('09:30'),'','maya',{title:'<img src=x onerror=alert(1)>'})];
  const html=ui.view({tasks,event},false),details=ui.details(tasks[0],false,event,tasks);
  assert.match(html,/2 activities have owner overlaps/);assert.equal((html.match(/>Owner overlap</g)||[]).length,2);
  assert.match(details,/Owner overlap · 1 activity/);assert.match(details,/data-action="task" data-id="b&quot;&lt;&gt;"/);
  assert.match(details,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.doesNotMatch(details,/<img|<form/);
  assert.match(details,/Ask the organizer/);assert.match(details,/An end time is missing/);
  assert.match(ui.details(tasks[0],true,event,tasks),/id="scheduleForm"/);
  assert.doesNotMatch(ui.view({tasks:[tasks[0]],event},true),/Owner overlap|owner overlaps/);
});

test('schedule changes, reassignment, completion and reload recompute warnings without storing them',()=>{
  const store=GatherStore.createStore({storage:null,now:Date.parse('2026-10-01T12:00:00Z')});store.completeSetup(event);
  const a=store.addTask({title:'Sound check',owner:'maya',schedule:{start:at('09:00'),end:at('10:00'),location:'Hall'}});
  const b=store.addTask({title:'Welcome desk',owner:'maya',schedule:{start:at('09:30'),end:at('10:30'),location:'Entrance'}});
  const read=()=>pairs(store.getState().tasks);
  assert.equal(read().length,2,'saving a conflict remains allowed');
  const saved=store.exportState();ui.view(store.getState(),true);assert.equal(store.exportState(),saved);
  const restored=GatherStore.createStore({storage:{getItem:()=>saved,setItem(){}}});assert.equal(pairs(restored.getState().tasks).length,2);
  store.setTaskSchedule(b.id,{...b.schedule,start:at('10:00')});assert.deepEqual(read(),[]);
  store.setTaskSchedule(b.id,b.schedule);assert.equal(read().length,2);
  store.updateTask(b.id,{owner:'jules'});assert.deepEqual(read(),[]);
  store.updateTask(b.id,{owner:'maya'});assert.equal(read().length,2);
  store.setTaskSchedule(a.id,null);assert.deepEqual(read(),[]);
  store.setTaskSchedule(a.id,a.schedule);store.reportCompletion(a.id,'Sound check finished.','maya');assert.deepEqual(read(),[]);
});
