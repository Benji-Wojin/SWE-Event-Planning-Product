import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/schedule-ui.js';

const now='2026-10-03T16:30:00Z',event={timeZone:'America/Los_Angeles'};
const task=(id,start,end,extra={})=>({id,title:id,owner:'maya',status:'todo',schedule:{start:'2026-10-03T'+start,end:end?'2026-10-03T'+end:'',location:'Main hall'},...extra});
const ids=tasks=>tasks.map(t=>t.id);
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui=GatherScheduleUI.create({h,options:()=>'',person:h,statusBadge:h});

test('past slots and reached starts without ends stay visible for explicit progress follow-up',()=>{
  const tasks=[task('past','08:00','09:00'),task('no-end','09:00',''),task('blocked-past','07:00','08:00',{status:'blocked'}),
    task('current','09:00','10:00'),task('future','10:00','11:00'),task('done','08:00','09:00',{status:'done'}),
    task('waiting','08:00','09:00',{requiresVerification:true,reportedAt:now,status:'progress'}),
    task('verified','08:00','09:00',{requiresVerification:true,reportedAt:now,verifiedAt:now,status:'done'}),{id:'prep',status:'todo',dueDate:'2026-10-01'}];
  const before=structuredClone(tasks),live=GatherScheduleUI.timing(tasks,event.timeZone,now);
  assert.deepEqual(ids(live.followUp),['blocked-past','past','no-end']);
  assert.deepEqual(ids(live.current),['current']);assert.deepEqual(ids(live.next),['future']);
  assert.deepEqual(ids(GatherScheduleUI.timing([...tasks].reverse(),event.timeZone,now).followUp),ids(live.followUp));
  assert.deepEqual(tasks,before,'clock classification must not update task state');
});

test('exact time boundaries move unresolved activities into follow-up without assuming completion',()=>{
  const tasks=[task('window','09:00','09:30'),task('start-only','09:30',''),task('next','09:31','10:00')];
  const before=GatherScheduleUI.timing(tasks,event.timeZone,'2026-10-03T16:29:00Z');
  assert.deepEqual(ids(before.current),['window']);assert.deepEqual(before.followUp,[]);
  const at=GatherScheduleUI.timing(tasks,event.timeZone,now);
  assert.deepEqual(ids(at.followUp),['window','start-only']);assert.deepEqual(at.current,[]);
  assert.deepEqual(ids(at.next),['next']);assert.equal(tasks[0].status,'todo');
  for(const [time,zone]of [[now,''],[now,'Invalid/Zone'],['invalid',event.timeZone]])assert.deepEqual(GatherScheduleUI.timing(tasks,zone,time).followUp,[]);
});

test('follow-up shows truthful reasons and owner links, not automatic status controls or private notes',()=>{
  const item=task('id"<>','08:00','09:00',{title:'<img src=x onerror=alert(1)>',owner:'<Maya>',note:'HIDDEN_PRIVATE_NOTE'});
  item.schedule.location='<script>hall</script>';
  const html=ui.clock({event,members:[{id:item.owner},{id:'maya'}],tasks:[item,task('unknown','09:00','')]},now).markup;
  assert.match(html,/Check progress/);assert.match(html,/Check with the owner/);
  assert.match(html,/Past scheduled end/);assert.match(html,/Start time reached · no end set/);
  assert.match(html,/data-action="task" data-id="id&quot;&lt;&gt;"/);
  assert.match(html,/&lt;img/);assert.match(html,/&lt;Maya&gt;/);assert.match(html,/&lt;script&gt;hall/);
  assert.doesNotMatch(html,/<img|<script|HIDDEN_PRIVATE_NOTE|<form|data-action="(?:toggle-task|claim|complete)/);
});

test('personal follow-up never includes another owner or unassigned activities',()=>{
  const state={event,tasks:[task('mine','08:00','09:00'),task('other','08:00','09:00',{owner:'dev'}),task('unassigned','08:00','09:00',{owner:''})]};
  const html=ui.clock(state,now,{mine:true,actor:'maya'}).markup;
  assert.match(html,/data-id="mine"/);assert.doesNotMatch(html,/data-id="(?:other|unassigned)"/);
  assert.equal(ui.clock(state,now,{mine:true,actor:''}).markup,'');
  const future=ui.clock({event,tasks:[task('future','10:00','11:00')]},now).markup;
  assert.doesNotMatch(future,/Check progress/,'no empty warning section before the schedule');
});

test('saved completion, required verification and reassignment recompute follow-up immediately',()=>{
  const store=GatherStore.createStore({storage:null});store.completeSetup(event);
  const item=store.addTask({title:'Clear the welcome desk',owner:'maya',schedule:{start:'2026-10-03T08:00',end:'2026-10-03T09:00',location:''}});
  const scope={mine:true,actor:'maya'};
  assert.match(ui.clock(store.getState(),now,scope).markup,/Check progress/);
  store.updateTask(item.id,{owner:'dev'});assert.equal(ui.clock(store.getState(),now,scope).markup,'');
  store.updateTask(item.id,{owner:'maya'});store.reportCompletion(item.id,'Welcome desk cleared.','maya');
  assert.doesNotMatch(ui.clock(store.getState(),now,scope).markup,/Check progress/);
  const review=store.addTask({title:'Confirm exit check',owner:'maya',requiresVerification:true,schedule:{start:'2026-10-03T08:00',end:'2026-10-03T09:00',location:''}});
  store.reportCompletion(review.id,'Exit checked.','maya');
  assert.doesNotMatch(ui.clock(store.getState(),now,scope).markup,/Check progress/,'reported work awaits review, not another progress report');
  assert.match(ui.view(store.getState(),true,now,scope),/Awaiting verification/);
  assert.notEqual(store.getState().tasks.find(t=>t.id===review.id).status,'done');
});

test('overnight follow-up starts at the entered end in the event zone, not the viewer zone',()=>{
  const night={...task('night','23:00',''),schedule:{start:'2026-10-03T23:00',end:'2026-10-04T01:00',location:'Hall'}};
  const before=process.env.TZ;
  try{
    for(const viewer of ['UTC','Asia/Tokyo','Pacific/Auckland']){
      process.env.TZ=viewer;
      assert.deepEqual(GatherScheduleUI.timing([night],event.timeZone,'2026-10-04T07:30:00Z').followUp,[]);
      const live=GatherScheduleUI.timing([night],event.timeZone,'2026-10-04T08:00:00Z');
      assert.deepEqual(ids(live.followUp),['night']);
      assert.match(ui.clock({event,tasks:[night]},'2026-10-04T08:00:00Z').markup,/Oct 3, 2026/);
    }
  }finally{if(before===undefined)delete process.env.TZ;else process.env.TZ=before;}
});

test('legacy Done records lacking required verification are not presented as unreported work',()=>{
  const store=GatherStore.createStore({storage:null});store.completeSetup(event);
  const item=store.addTask({title:'Review venue clearance',owner:'maya',status:'done',requiresVerification:true,schedule:{start:'2026-10-03T08:00',end:'2026-10-03T09:00',location:''}});
  const state=store.getState(),before=structuredClone(state);
  assert.equal(item.reportedAt,'');assert.equal(item.verifiedAt,'');
  const live=GatherScheduleUI.timing(state.tasks,event.timeZone,now);
  assert.deepEqual(live.followUp,[]);assert.equal(live.labels.has(item.id),false);
  assert.doesNotMatch(ui.clock(state,now).markup,/Check progress/);
  assert.match(ui.view(state,true,now),/Awaiting verification/);
  const sheet=GatherScheduleUI.create({h,options:()=>'',person:h,statusBadge:h}).runSheet(state,now);
  assert.match(sheet,/Awaiting verification/);assert.deepEqual(state,before);
});
