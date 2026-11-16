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
  assert.match(html,/When a report is available, only the organizer can verify it or request changes/);
  for(const id of ['Review arrival','Legacy done'])assert.equal(live.labels.has(id),false);
  assert.equal(live.labels.get('Unreported work'),'Past scheduled end');
  assert.doesNotMatch(html,/Verified|No verification needed|Unscheduled preparation|<form(?! id="scheduleDateForm")|data-action="verify-task"/);
  assert.deepEqual(input,before);
});

test('saved review survives a missing or invalid event time zone without claiming live timing',()=>{
  const input=state([task('stored-review'),task('stored-amendment',{
    status:'done',verifiedAt:now,completionEvidence:{note:'PRIVATE-AMENDMENT'},
  }),task('no-report',{requiresVerification:false,reportedAt:''})]);
  for(const timeZone of ['', 'Invalid/Zone']){
    const saved={...input,event:{timeZone}};
    const live=ui.clock(saved,now,{date:'2026-11-20'},true);
    assert.match(live.markup,/Completion awaiting verification · 1/);
    assert.match(live.markup,/Evidence amended after verification · 1/);
    assert.match(live.markup,/data-id="stored-review" data-review-kind="completion"/);
    assert.match(live.markup,/data-id="stored-amendment" data-review-kind="amendment"/);
    assert.doesNotMatch(live.markup,/Scheduled now|\bNext\b|Check progress|no-report|PRIVATE-AMENDMENT/);
    assert.equal(live.labels.size,0);
    assert.equal(live.rowDays.size,0);
  }
});

test('review group follows My activities and includes no other owner, unassigned or unscheduled work',()=>{
  const input=state([task('Mine'),task('Other',{owner:'dev'}),task('Unassigned',{owner:''}),task('Preparation',{schedule:null})]);
  const mine=ui.clock(input,now,{mine:true,actor:'maya'}).markup;
  assert.match(mine,/Completion awaiting verification · 1/);assert.deepEqual(ids(mine),['Mine']);
  for(const actor of ['',undefined,'unknown'])assert.equal(ui.clock(input,now,{mine:true,actor}).markup,'');
  assert.match(ui.clock(input,now).markup,/Completion awaiting verification · 3/);
});

test('organizer live cards open the exact review while timetable, teammate and snapshot links stay unchanged',()=>{
  const input=state([task('pending'),task('amended',{status:'done',verifiedAt:now,completionEvidence:{note:'PRIVATE_EVIDENCE'}}),
    task('legacy',{status:'done',reportedAt:''}),task('outside',{owner:'dev'})]);
  const before=structuredClone(input),scope={mine:true,actor:'maya',date:'2026-11-20'};
  const expected=[['pending','completion'],['amended','amendment']];
  const reviewLinks=markup=>[...markup.matchAll(/data-action="review-organizer-item" data-id="([^"]+)" data-review-kind="([^"]+)"/g)].map(([,id,kind])=>[id,kind]);
  const organizer=ui.view(input,true,now,scope),clock=ui.clock(input,now,scope,true).markup;
  assert.deepEqual(reviewLinks(organizer),expected);
  assert.deepEqual(reviewLinks(clock),expected);
  assert.deepEqual(ids(clock),['legacy']);
  assert.equal(ids(organizer).filter(id=>id==='pending').length,1,'the dated row still opens the ordinary task');
  assert.equal(ids(organizer).filter(id=>id==='amended').length,1);
  assert.deepEqual(reviewLinks(ui.view(input,false,now,scope)),[]);
  assert.deepEqual(reviewLinks(ui.clock(input,now,scope).markup),[]);
  const sheet=ui.runSheet(input,now,scope);
  assert.doesNotMatch(organizer+clock+sheet,/PRIVATE_EVIDENCE|data-action="verify-task"|>outside</);
  assert.doesNotMatch(sheet,/data-action=|data-review-kind=/);
  assert.deepEqual(input,before);
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
    const html=ui.view(input,false,now);
    assert.equal(ids(html).filter(id=>id==='Future report').length,3,'one review card plus the start and continuation rows');
    assert.match(html,/data-id="Future report" data-schedule-day="2026-11-22"/);
    assert.doesNotMatch(ui.clock(state([]),now).markup,/Completion awaiting verification/);
  }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
  const css=readFileSync('legacy/styles.css','utf8');assert.match(css,/\.schedule-follow-up,\.schedule-completion-review\{grid-column:1\/-1/);
});

test('selected non-today dates show saved completion and amendment review, but no live clock cues',()=>{
  const slot=(start,end)=>({start,end,location:'Fictional hall'});
  const carryover=task('my-pending',{schedule:slot('2026-11-19T23:30','2026-11-20T00:30'),note:'PRIVATE-NOTE'});
  const amended=task('my-amended',{status:'done',verifiedAt:now,schedule:slot('2026-11-21T23:00','2026-11-22T01:00'),
    completionEvidence:{note:'PRIVATE-AMENDMENT',links:['https://private.example/'],fileIds:['PRIVATE-FILE']}});
  const input=state([carryover,amended,
    task('legacy-awaiting',{status:'done',reportedAt:'',schedule:slot('2026-11-22T10:00','2026-11-22T10:15')}),
    task('other-report',{owner:'dev',schedule:slot('2026-11-22T10:15','2026-11-22T10:30')}),
    task('unassigned-report',{owner:'',schedule:slot('2026-11-22T10:30','2026-11-22T11:00')}),
    task('old-unreported',{reportedAt:'',requiresVerification:false,schedule:slot('2026-11-19T08:00','2026-11-19T09:00')}),
    task('future-unreported',{reportedAt:'',requiresVerification:false,schedule:slot('2026-11-22T09:00','2026-11-22T09:15')}),
    task('already-reviewed',{status:'done',verifiedAt:now,completionEvidenceReviewAt:now,completionEvidence:{note:'PRIVATE-REVIEWED'},
      schedule:slot('2026-11-22T11:30','2026-11-22T12:00')}),
    task('archived-report',{archivedAt:now,schedule:slot('2026-11-22T12:00','2026-11-22T13:00')}),
    task('unrelated-report',{schedule:null}),
    task('starts-today',{reportedAt:'',requiresVerification:false,schedule:slot('2026-11-20T14:30','2026-11-20T15:30')}),
  ]);
  const before=structuredClone(input);
  const reviewLinks=markup=>[...markup.matchAll(/data-action="review-organizer-item" data-id="([^"]+)" data-review-kind="([^"]+)"/g)]
    .map(([,id,kind])=>[id,kind]);
  const staticOnly=live=>{
    assert.equal(live.labels.size,0);
    assert.equal(live.rowDays.size,0);
    assert.doesNotMatch(live.markup,/Scheduled now|\bNext\b|Check progress|Past scheduled end|schedule-focus-reason/);
  };
  const past=ui.clock(input,now,{date:'2026-11-19'},true);
  assert.match(past.markup,/Completion awaiting verification · 1/);
  assert.deepEqual(reviewLinks(past.markup),[['my-pending','completion']]);
  assert.match(past.markup,/data-schedule-focus-day="2026-11-19"[^>]+data-id="my-pending"/);
  assert.doesNotMatch(past.markup,/old-unreported|my-amended/);
  staticOnly(past);

  const scope={date:'2026-11-22',mine:true,actor:'maya'};
  const future=ui.clock(input,now,scope,true);
  staticOnly(future);
  assert.match(future.markup,/Completion awaiting verification · 1/);
  assert.match(future.markup,/Evidence amended after verification · 1/);
  assert.deepEqual(reviewLinks(future.markup),[['my-amended','amendment']]);
  assert.deepEqual(ids(future.markup),['legacy-awaiting'],'no fictional report review for historical done without a report');
  assert.match(future.markup,/data-schedule-focus-day="2026-11-22"[^>]+data-id="my-amended"/);
  assert.doesNotMatch(future.markup,/my-pending|other-report|unassigned-report|already-reviewed|archived-report|unrelated-report|future-unreported/);
  const teammate=ui.clock(input,now,scope,false);
  staticOnly(teammate);
  assert.deepEqual(reviewLinks(teammate.markup),[]);
  assert.deepEqual(ids(teammate.markup),['legacy-awaiting','my-amended']);

  const all=ui.clock(input,now,{date:scope.date},true);
  staticOnly(all);
  assert.match(all.markup,/Completion awaiting verification · 3/);
  assert.deepEqual(reviewLinks(all.markup),[['other-report','completion'],['unassigned-report','completion'],['my-amended','amendment']]);
  assert.equal(ui.clock(input,now,{...scope,actor:'unknown'},true).markup,'');
  assert.equal(ui.clock(input,now,{date:'2026-11-23'},true).markup,'');
  const timetable=ui.view(input,true,now,scope);
  assert.match(timetable,/data-id="my-amended" data-schedule-day="2026-11-22"[^>]*>[\s\S]*?Continues from/);
  assert.match(timetable,/data-schedule-phase="future-unreported" data-schedule-phase-day="2026-11-22" hidden><\/span>/);
  assert.doesNotMatch(timetable+past.markup+all.markup,/PRIVATE-|private\.example|data-action="verify-task"/);
  const today=ui.clock(input,now,{date:'2026-11-20'},true);
  assert.match(today.markup,/Scheduled now/);
  assert.equal(today.labels.get('starts-today'),'Scheduled now');
  assert.deepEqual(reviewLinks(today.markup),[['my-pending','completion']],'the carried-over attendance remains reviewable on its next day');
  assert.deepEqual(input,before);
});
