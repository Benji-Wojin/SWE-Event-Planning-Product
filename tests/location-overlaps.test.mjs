import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/schedule-ui.js';

const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui=GatherScheduleUI.create({h,options:()=>'',person:h,statusBadge:h});
const at=time=>'2026-11-06T'+time;
const task=(id,start='09:00',end='10:00',location='East hall',owner='jack',extra={})=>({id,title:id,owner,status:'todo',schedule:{start:at(start),end:end?at(end):'',location},...extra});
const state=tasks=>({event:{name:'Corporate summit',date:'2026-11-06',timeZone:'America/Los_Angeles'},members:[{id:'jack',name:'Jack'},{id:'maya',name:'Maya'}],tasks});
const pairs=tasks=>[...GatherScheduleUI.locationOverlaps(tasks)].map(([id,others])=>[id,others.map(t=>t.id).sort()]).sort(([a],[b])=>a.localeCompare(b));
const review=(s,scope={})=>GatherScheduleUI.reviewItems(s,Date.parse('2026-11-01T12:00Z'),scope).find(g=>g.key==='locations').tasks.map(t=>t.id);

test('location overlaps include different or missing owners, with symmetric stable results and no writes',()=>{
  const tasks=[task('a','09:00','12:00'),task('b','10:00','11:00','East hall','maya'),task('c','10:30','11:30','East hall','')];
  const before=structuredClone(tasks),expected=[['a',['b','c']],['b',['a','c']],['c',['a','b']]];
  assert.deepEqual(pairs(tasks),expected);assert.deepEqual(pairs([...tasks].reverse()),expected);assert.deepEqual(tasks,before);
  assert.deepEqual([...GatherScheduleUI.ownerOverlaps(tasks)],[],'space overlaps are separate from owner overlaps');
});
test('matching normalizes case, compatibility characters and whitespace, never guesses aliases or generic empty spaces',()=>{
  for(const location of [' east HALL ','East\u00a0\u00a0hall','Ｅａｓｔ hall','East\n hall'])assert.equal(pairs([task('a'),task('b','09:30','10:30',location)]).length,2,location);
  for(const location of ['',undefined,'   ','East hall 2','East-hall','Main hall','east hall, floor 1'])assert.deepEqual(pairs([task('a'),{...task('b','09:30','10:30'),schedule:{start:at('09:30'),end:at('10:30'),location}}]),[]);
});
test('touching windows and finished work do not warn; reported or blocked work stays unresolved',()=>{
  const a=task('a');
  for(const b of [task('b','10:00','11:00'),task('b','09:30','10:30','East hall','maya',{status:'done'}),task('b','09:30','10:30','East hall','maya',{status:'done',requiresVerification:true,verifiedAt:'2026-11-06T18:00Z'})])assert.deepEqual(pairs([a,b]),[]);
  for(const status of ['todo','progress','blocked','done'])assert.equal(pairs([a,task('b','09:30','10:30','East hall','maya',{status,requiresVerification:true,reportedAt:'2026-11-06T18:00Z'})]).length,2);
  assert.deepEqual(pairs([a,{id:'unscheduled',title:'Prep',status:'todo',owner:'jack'}]),[]);
});
test('missing ends warn only for simultaneous starts or starts inside a known window',()=>{
  for(const b of [task('b','09:00',''),task('b','09:00','10:00'),task('b','08:00','10:00')])assert.equal(pairs([task('a','09:00',''),b]).length,2);
  for(const b of [task('b','09:30','10:00'),task('b','08:00','09:00')])assert.deepEqual(pairs([task('a','09:00',''),b]),[]);
});
test('multi-day windows compare event-local dates independently of the viewer zone',()=>{
  const a=task('overnight');a.schedule={start:'2026-11-06T23:30',end:'2026-11-07T00:30',location:'East hall'};
  const b=task('cleanup');b.schedule={start:'2026-11-07T00:00',end:'2026-11-07T01:00',location:'East hall'};
  const original=process.env.TZ;
  try{for(const zone of ['UTC','Asia/Tokyo','America/Los_Angeles']){process.env.TZ=zone;assert.deepEqual(pairs([a,b]),[['cleanup',['overnight']],['overnight',['cleanup']]]);}}finally{if(original===undefined)delete process.env.TZ;else process.env.TZ=original;}
});
test('My activities still warns about other teams using the same location without adding their rows to the view or export',()=>{
  const s=state([task('mine'),task('other','09:30','10:30','East hall','maya')]),scope={mine:true,actor:'jack'};
  assert.deepEqual(review(s,scope),['mine']);assert.deepEqual(review(s),['mine','other']);
  const html=ui.view(s,false,Date.now(),scope),sheet=ui.runSheet(s,Date.now(),scope);
  for(const output of [html,sheet]){assert.match(output,/1 activit(?:y|ies).*potential location overlap/i);assert.match(output,/Potential location overlap/);assert.doesNotMatch(output,/>other</);}
  assert.doesNotMatch(ui.view(s,false,Date.now(),{mine:true,actor:'absent'}),/potential location overlap/i);
});
test('details explain uncertainty, link escaped competing activities and grant no edit authority to members',()=>{
  const a=task('mine'),b=task('b"<>','09:30','','East hall','maya',{title:'<img src=x>',note:'PRIVATE_NOTE',comments:[{text:'PRIVATE_COMMENT'}]});
  const html=ui.details(a,false,state([]).event,[a,b]);
  assert.match(html,/Potential location overlap · 1 activity/);assert.match(html,/Ask the organizer/);assert.match(html,/shared or divisible/);assert.match(html,/Matching location labels/);assert.match(html,/end time is missing/);
  assert.match(html,/data-id="b&quot;&lt;&gt;"/);assert.match(html,/&lt;img src=x&gt;/);assert.doesNotMatch(html,/<img|<form|PRIVATE_/);
  assert.match(ui.details(a,true,state([]).event,[a,b]),/id="scheduleForm"/);
  const sheet=ui.runSheet(state([a,b]));assert.doesNotMatch(sheet,/<img|PRIVATE_|data-action/);assert.match(sheet,/&lt;img src=x&gt;/);
});
test('changing location or time and actual completion recalculate warnings without storing conflict state or changing progress',()=>{
  const store=GatherStore.createStore({storage:null});store.completeSetup({date:'2026-11-06',timeZone:'America/Los_Angeles'});
  const a=store.addTask({title:'School dance setup',owner:'jack',schedule:{start:at('09:00'),end:at('10:00'),location:'Hall'}});
  const b=store.addTask({title:'Volunteer briefing',owner:'maya',schedule:{start:at('09:30'),end:at('10:30'),location:'Hall'}});
  const read=()=>pairs(store.getState().tasks);assert.equal(read().length,2);const before=store.exportState();ui.view(store.getState(),true);assert.equal(store.exportState(),before);
  store.setTaskSchedule(b.id,{...b.schedule,location:'Side room'});assert.deepEqual(read(),[]);
  store.setTaskSchedule(b.id,{...b.schedule,start:at('10:00')});assert.deepEqual(read(),[]);
  store.setTaskSchedule(b.id,b.schedule);assert.equal(read().length,2);assert.equal(store.getState().tasks.find(t=>t.id===b.id).status,'todo');
  const restored=GatherStore.createStore({storage:{getItem:()=>store.exportState(),setItem(){}}});assert.equal(pairs(restored.getState().tasks).length,2);
  store.reportCompletion(a.id,'Setup completed.','jack');assert.deepEqual(read(),[]);
});
