import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/schedule-ui.js';

const now='2026-11-20T23:00:00Z',event={timeZone:'America/Los_Angeles'};
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui=GatherScheduleUI.create({h,options:()=>'',person:h,statusBadge:status=>'<span>'+h(status)+'</span>'});
const task=(id,extra={})=>({id,title:id,owner:'maya',status:'progress',requiresVerification:true,reportedAt:now,verifiedAt:'',schedule:{start:'2026-11-20T14:00',end:'2026-11-20T14:30',location:'School hall'},...extra});
const state=tasks=>({event,members:[{id:'maya',name:'Maya'},{id:'dev',name:'Dev'}],tasks});
const ids=html=>[...html.matchAll(/data-action="task" data-id="([^"]+)"/g)].map(match=>match[1]);

test('live focus exposes pending activity verification separately from clock and progress cues',()=>{
  const input=state([task('Review arrival'),task('Legacy done',{status:'done',reportedAt:''}),
    task('Verified',{status:'done',verifiedAt:now}),task('No verification needed',{status:'done',requiresVerification:false}),
    task('Unscheduled preparation',{schedule:null}),task('Unreported work',{reportedAt:'',requiresVerification:false})]);
  const before=structuredClone(input),live=ui.clock(input,now),html=live.markup;
  assert.match(html,/Completion awaiting verification · 2/);
  assert.equal((html.match(/>Awaiting verification<\/span>/g)||[]).length,2);
  assert.deepEqual(ids(html),['Legacy done','Review arrival','Unreported work']);
  assert.match(html,/only the organizer can verify or request changes/);
  for(const id of ['Review arrival','Legacy done'])assert.equal(live.labels.has(id),false);
  assert.equal(live.labels.get('Unreported work'),'Past scheduled end');
  assert.doesNotMatch(html,/Verified|No verification needed|Unscheduled preparation|<form|data-action="verify-task"/);
  assert.deepEqual(input,before);
});

test('review group follows My activities and includes no other owner, unassigned or unscheduled work',()=>{
  const input=state([task('Mine'),task('Other',{owner:'dev'}),task('Unassigned',{owner:''}),task('Preparation',{schedule:null})]);
  const mine=ui.clock(input,now,{mine:true,actor:'maya'}).markup;
  assert.match(mine,/Completion awaiting verification · 1/);assert.deepEqual(ids(mine),['Mine']);
  for(const actor of ['',undefined,'unknown'])assert.equal(ui.clock(input,now,{mine:true,actor}).markup,'');
  assert.match(ui.clock(input,now).markup,/Completion awaiting verification · 3/);
});

test('verification focus uses escaped schedule facts and never includes report, evidence or comments',()=>{
  const item=task('id"<>',{title:'<img src=x>',owner:'<owner>',note:'PRIVATE-NOTE',completionResult:{text:'PRIVATE-RESULT'},comments:[{text:'PRIVATE-COMMENT'}],completionEvidence:{note:'PRIVATE-EVIDENCE',links:['https://private.example']}});
  item.schedule.location='<script>hall</script>';
  const input=state([item]),html=ui.clock(input,now).markup;
  assert.match(html,/&lt;img src=x&gt;/);assert.match(html,/data-id="id&quot;&lt;&gt;"/);
  assert.match(html,/&lt;script&gt;hall&lt;\/script&gt;/);assert.match(html,/Assigned owner unavailable/);
  assert.doesNotMatch(html,/<img|<script|PRIVATE-|private\.example|data-action="(?:complete|claim|verify)/);
});

test('saved report, changes request, resubmission and verification update the review group without extra mutations',()=>{
  const store=GatherStore.createStore({storage:null});store.completeSetup(event);
  const activity=store.addTask({title:'Check guest arrival setup',owner:'maya',requiresVerification:true,schedule:task('').schedule});
  const render=()=>{const saved=store.exportState(),html=ui.clock(store.getState(),now,{mine:true,actor:'maya'}).markup;assert.equal(store.exportState(),saved);return html;};
  assert.doesNotMatch(render(),/Completion awaiting verification/);
  store.reportCompletion(activity.id,'Arrival setup checked.','maya');assert.match(render(),/Completion awaiting verification · 1/);assert.doesNotMatch(render(),/Check progress/);
  assert.throws(()=>store.verifyTask(activity.id,'maya'),/organizer/);assert.match(render(),/Completion awaiting verification/);
  store.returnCompletion(activity.id,'Confirm the named greeter.');assert.doesNotMatch(render(),/Completion awaiting verification/);assert.match(render(),/Changes requested/);
  store.reportCompletion(activity.id,'Named greeter confirmed.','maya');assert.match(render(),/Completion awaiting verification · 1/);
  store.verifyTask(activity.id);assert.doesNotMatch(render(),/Completion awaiting verification|Check progress/);
  assert.equal(store.getState().tasks.find(t=>t.id===activity.id).status,'done');
});

test('future and overnight pending reviews remain factual across viewer zones and preserve timetable rows',()=>{
  const input=state([task('Future report',{schedule:{start:'2026-11-21T23:00',end:'2026-11-22T01:00',location:'Corporate hall'}})]),previous=process.env.TZ;
  try{
    let first;
    for(const zone of ['UTC','Asia/Tokyo','Pacific/Auckland']){
      process.env.TZ=zone;const html=ui.clock(input,now).markup;
      if(first)assert.equal(html,first);first=html;
      assert.match(html,/Completion awaiting verification · 1/);assert.match(html,/Nov 21, 2026/);assert.match(html,/Nov 22, 2026/);
      assert.doesNotMatch(html,/schedule-focus-reason|>Next<\/span>|>Scheduled now<\/span>/);
    }
    const html=ui.view(input,false,now);assert.equal(ids(html).filter(id=>id==='Future report').length,2,'focus card plus dated timetable row');
    assert.doesNotMatch(ui.clock(state([]),now).markup,/Completion awaiting verification/);
  }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
  const css=readFileSync('legacy/styles.css','utf8');assert.match(css,/\.schedule-follow-up,\.schedule-completion-review\{grid-column:1\/-1/);
});
