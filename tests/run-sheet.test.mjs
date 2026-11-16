import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/schedule-ui.js';

const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui=GatherScheduleUI.create({h,options:()=>'',person:()=>{throw Error('No profile markup in a run sheet');},statusBadge:()=>{throw Error('No badge markup in a run sheet');}});
const now=Date.parse('2026-11-20T23:00:00Z');
const activity=(id,owner,start,end='',extra={})=>({id,title:id,owner,status:'todo',schedule:{start,end,location:'East hall'},...extra});
const state=()=>({event:{name:'School dance',timeZone:'America/Los_Angeles',bookingReference:'PRIVATE-EVENT'},members:[{id:'maya',name:'Maya Chen',email:'PRIVATE-EMAIL'}],tasks:[
  activity('Later','maya','2026-11-21T09:00'),
  activity('Check-in','maya','2026-11-20T17:30','2026-11-20T18:00',{note:'PRIVATE-NOTE',comments:[{text:'PRIVATE-COMMENT'}]}),
  activity('Sound check','','2026-11-20T17:00','2026-11-20T17:30'),
  {id:'prep',title:'PREPARATION-ONLY',dueDate:'2026-11-20'},
],guests:[{name:'PRIVATE-GUEST'}],files:[{name:'PRIVATE-FILE'}],messages:[{body:'PRIVATE-MAIL'}],privateRecords:[{reference:'PRIVATE-BOOKING'}]});

test('run sheet is an ordered event-zone snapshot of schedule facts, not a workspace export',()=>{
  const input=state(),before=structuredClone(input),html=ui.runSheet(input,now);
  assert.ok(html.indexOf('Sound check')<html.indexOf('Check-in'));
  assert.ok(html.indexOf('Check-in')<html.indexOf('Later'));
  assert.match(html,/School dance/);assert.match(html,/2026-11-20 · 15:00 · America\/Los_Angeles/);
  assert.match(html,/5:30 PM – 6:00 PM/);assert.match(html,/Maya Chen/);assert.match(html,/Unassigned/);
  assert.match(html,/No end time set/);assert.match(html,/This copy is not live/);
  assert.match(html,/scheduled times never mark work complete/);assert.match(html,/downloaded copies cannot be recalled/);
  assert.doesNotMatch(html,/PRIVATE-(?:EVENT|EMAIL|NOTE|COMMENT|GUEST|FILE|MAIL|BOOKING)|PREPARATION-ONLY|data-action|<form/);
  assert.deepEqual(input,before);
});

test('personal run sheets contain only the signed-in actor schedule, with truthful empty states',()=>{
  const input=state(),html=ui.runSheet(input,now,{mine:true,actor:'maya'});
  assert.match(html,/My activities · Maya Chen/);assert.match(html,/Check-in/);assert.doesNotMatch(html,/Sound check/);
  for(const actor of ['other','',undefined])assert.match(ui.runSheet(input,now,{mine:true,actor}),/No scheduled activities in this view/);
  assert.match(ui.runSheet({...input,tasks:[]},now),/No scheduled activities in this view/);
});

test('offline copies call out uncovered activities and unusable local times without revealing other scopes',()=>{
  const input=state(),date='2026-11-01',open=activity('Uncovered','',date+'T00:10',date+'T00:30');
  input.tasks=[open,activity('Already finished','',date+'T00:30',date+'T00:40',{status:'done'}),
    activity('Repeated clock','maya',date+'T01:30',date+'T02:15'),
    activity('Other team repeated clock','dev',date+'T01:35',date+'T02:20'),
    activity('Another day uncovered','','2026-11-02T09:00')];
  const snapshot=structuredClone(input);
  const output=scope=>{
    const model=ui.runSheetModel(input,now,scope);
    return [ui.runSheetMarkup(model),ui.runSheetText(model)];
  };
  for(const copy of output({date})){
    assert.match(copy,/1 activity has no owner assigned/);
    assert.match(copy,/2 activities have saved times that need correction/);
    assert.match(copy,/Do not rely on the flagged times/);
    assert.match(copy,/Start time 2026-11-01 01:30 occurs twice/);
    assert.doesNotMatch(copy,/Another day uncovered/);
  }
  for(const copy of output({date,mine:true,actor:'maya'})){
    assert.match(copy,/1 activity has a saved time that needs correction/);
    assert.match(copy,/Repeated clock/);
    assert.doesNotMatch(copy,/no owner assigned|Uncovered|Other team repeated clock/);
  }
  assert.deepEqual(input,snapshot);
});

test('a carryover row only warns about overlaps that actually reach its displayed date',()=>{
  const input=state();
  input.tasks=[
    activity('Overnight check-in','maya','2026-11-20T22:00','2026-11-21T01:00'),
    activity('Friday handoff','maya','2026-11-20T23:00','2026-11-21T00:00'),
    activity('Saturday room check','dev','2026-11-21T00:30','2026-11-21T01:30'),
  ];
  const model=ui.runSheetModel(input,now),[friday,saturday]=model.days;
  assert.deepEqual(friday.rows[0].activityWarnings,['Owner overlap','Potential location overlap']);
  assert.deepEqual(saturday.rows[0].activityWarnings,['Potential location overlap']);
  assert.deepEqual(saturday,ui.runSheetModel(input,now,{date:'2026-11-21'}).days[0]);
  assert.match(ui.runSheetMarkup(model),/2 activities have owner overlaps/);
  const live=GatherScheduleUI.create({h,statusBadge:h}).view(input,false,now);
  const carriedRow=live.match(/data-id="Overnight check-in" data-schedule-day="2026-11-21"[^>]*>([\s\S]*?)<\/button>/)?.[1];
  assert.match(carriedRow,/Continues from.*Potential location overlap/);
  assert.doesNotMatch(carriedRow,/Owner overlap/);
});

test('live Run sheet row targets use a separate ordinal map and leave every export fact unchanged',()=>{
  const input=state(),overnight='private-overnight-id',later='private-later-id';
  input.tasks=[
    activity(later,'maya','2026-11-21T04:00','2026-11-21T04:30',{title:'Same <hall> title'}),
    activity(overnight,'maya','2026-11-20T22:00','2026-11-21T01:00',{title:'Same <hall> title'}),
    activity('private-other-id','dev','2026-11-21T01:15','2026-11-21T02:00',{title:'Other scope'}),
  ];
  const before=structuredClone(input),scope={mine:true,actor:'maya'},targets=new Map([['discard-me',{}]]);
  const model=ui.runSheetModel(input,now,scope,targets),plain=ui.runSheetModel(input,now,scope);
  assert.deepEqual([...targets],[
    ['0-0',{id:overnight,day:'2026-11-20'}],
    ['1-0',{id:overnight,day:'2026-11-21'}],
    ['1-1',{id:later,day:'2026-11-21'}],
  ]);
  assert.deepEqual(model,plain);
  assert.deepEqual(input,before);
  const interactive=ui.runSheetMarkup(model,targets),printable=ui.runSheetMarkup(plain);
  const buttons=[...interactive.matchAll(/<button[^>]*data-action="review-run-sheet-row"[^>]*>Show in Timeline<\/button>/g)].map(([markup])=>markup);
  assert.equal(buttons.length,3);
  assert.match(buttons[0],/type="button".*run-sheet-live-action.*data-run-sheet-row="0-0".*aria-describedby="runSheetReviewDetailsStatus"/);
  assert.match(buttons[0],/aria-label="Show in Timeline: Same &lt;hall&gt; title · Fri, Nov 20, 2026 · 10:00 PM/);
  assert.match(buttons[1],/aria-label="Show in Timeline: Same &lt;hall&gt; title · Sat, Nov 21, 2026 · 10:00 PM/);
  assert.match(buttons[2],/aria-label="Show in Timeline: Same &lt;hall&gt; title · Sat, Nov 21, 2026 · 4:00 AM/);
  assert.doesNotMatch(interactive,/private-(?:overnight|later|other)-id|Other scope|data-id=/);
  assert.equal(interactive.replace(/<button[^>]*data-action="review-run-sheet-row"[^>]*>Show in Timeline<\/button>/g,''),printable);
  assert.match(printable,/<header>[\s\S]*?<p[^>]*data-run-sheet-update-warning hidden><\/p>[\s\S]*?<\/header>/);
  const continuationHeaders=[...printable.matchAll(/<tr class="run-sheet-repeat-heading">(.*?)<\/tr>/g)].map(([,heading])=>heading);
  assert.equal(continuationHeaders.length,model.days.length);
  assert.ok(continuationHeaders.every(heading=>/<span data-run-sheet-update-warning hidden><\/span>/.test(heading)),
    'each repeating print header can distinguish an offline copy');
  assert.equal(ui.runSheet(input,now,scope),printable);
  assert.equal(ui.runSheetText(model),ui.runSheetText(plain));
  assert.doesNotMatch(ui.runSheetText(model),/Show in Timeline|private-(?:overnight|later|other)-id/);
  assert.match(readFileSync('legacy/styles.css','utf8'),/@media print\{\s*#eventRunSheet \.run-sheet-live-action\{display:none!important\}/);
  const dated=ui.runSheetModel(input,now,{...scope,date:'2026-11-21'},targets);
  assert.equal(dated.days.length,1);
  assert.deepEqual([...targets],[['0-0',{id:overnight,day:'2026-11-21'}],['0-1',{id:later,day:'2026-11-21'}]]);
  const empty=ui.runSheetModel(input,now,{...scope,date:'2026-11-22'},targets);
  assert.equal(targets.size,0);
  assert.doesNotMatch(ui.runSheetMarkup(empty,targets),/review-run-sheet-row/);
});

test('explicitly planned but untimed activities stay visible in the right scope, outside the run sheet',()=>{
  const input=state();
  input.tasks=[
    {id:'pending',title:'Guest welcome <desk>',status:'todo',eventActivity:true,owner:'maya'},
    {id:'other',title:'Other team activity',status:'todo',eventActivity:true,owner:'other'},
    {id:'done',title:'Finished activity',status:'done',eventActivity:true,owner:'maya'},
    {id:'prep',title:'Order signs',status:'todo',owner:'maya'},
  ];
  const view=GatherScheduleUI.create({h,options:(items,selected)=>items.map(([id,label])=>`<option value="${h(id)}"${id===selected?' selected':''}>${h(label)}</option>`).join(''),person:()=>'<span>Teammate</span>',statusBadge:()=>''});
  const mine={mine:true,actor:'maya'};
  const organizer=view.view(input,true,now,mine),participant=view.view(input,false,now,mine);
  assert.match(organizer,/Activities need a start time · 1/);
  assert.match(organizer,/data-action="schedule-set-start" data-id="pending" aria-label="Set start time for Guest welcome &lt;desk&gt;"/);
  assert.match(participant,/Guest welcome &lt;desk&gt;/);
  assert.doesNotMatch(participant,/data-action="schedule-set-start"|Other team activity|Finished activity|Order signs|No activities assigned/);
  assert.match(view.details(input.tasks[0],false,input.event),/Planned activity · no start time/);
  assert.match(view.picker(input,'pending'),/value="pending" selected/);
  assert.doesNotMatch(view.picker(input,'foreign'),/value="pending" selected/);
  const groups=GatherScheduleUI.reviewItems(input,now,mine);
  assert.deepEqual(groups.find(group=>group.key==='activity-time').tasks.map(task=>task.id),['pending']);
  assert.deepEqual(groups.find(group=>group.key==='preparation').tasks.map(task=>task.id),['prep']);
  assert.doesNotMatch(view.runSheet(input,now,mine),/Guest welcome|Other team activity/);
  assert.match(view.runSheet(input,now,mine),/1 planned activity is not shown/);
  assert.match(view.runSheet(input,now),/2 planned activities are not shown/);
  input.tasks[0].schedule={start:'2026-11-20T17:30',end:'',location:''};
  assert.doesNotMatch(view.view(input,true,now,mine),/Activities need a start time/);
  assert.match(view.runSheet(input,now,mine),/Guest welcome &lt;desk&gt;/);
  assert.doesNotMatch(view.runSheet(input,now,mine),/planned activit.*not shown/);
});

test('run sheet retains blocked/completed/review states and warns about entered owner overlaps',()=>{
  const input=state();input.tasks=[
    activity('Blocked','maya','2026-11-20T17:00','2026-11-20T18:00',{status:'blocked'}),
    activity('Pending','maya','2026-11-20T17:30','2026-11-20T18:30',{status:'done',requiresVerification:true,reportedAt:'2026-11-20T22:00Z'}),
    activity('Verified','maya','2026-11-20T17:30','2026-11-20T18:30',{status:'done',requiresVerification:true,verifiedAt:'2026-11-20T22:05Z'}),
  ];
  const html=ui.runSheet(input,now);
  assert.match(html,/2 activities have owner overlaps/);assert.equal((html.match(/<span>Owner overlap<\/span>/g)||[]).length,2);
  assert.match(html,/Awaiting verification/);assert.match(html,/>Blocked<\/td>/);assert.match(html,/>Done<\/td>/);
  assert.doesNotMatch(html,/Scheduled now/);
});

test('the printable and text run sheets aggregate saved completion awaiting verification once per scoped activity',()=>{
  const input=state(),report='2026-11-20T22:00:00Z';
  input.members.push({id:'dev',name:'Fictional other host'});
  input.tasks=[
    activity('private-carryover-id','maya','2026-11-20T23:20','2026-11-21T01:00',{title:'Overnight report',status:'progress',
      requiresVerification:true,reportedAt:report,completionEvidence:{note:'PRIVATE-EVIDENCE',links:['https://private.example/'],fileIds:['PRIVATE-ATTACHMENT']},
      completionResult:{text:'PRIVATE-RESULT'},note:'PRIVATE-NOTE',comments:[{text:'PRIVATE-COMMENT'}]}),
    activity('private-legacy-id','maya','2026-11-21T10:00','2026-11-21T10:30',{title:'Legacy unverified',status:'done',requiresVerification:true}),
    activity('private-other-id','dev','2026-11-21T11:00','2026-11-21T11:30',{title:'Different owner report',status:'progress',requiresVerification:true,reportedAt:report}),
    activity('private-amendment-id','maya','2026-11-21T12:00','2026-11-21T12:30',{title:'Already verified amendment',status:'done',requiresVerification:true,
      verifiedAt:report,completionEvidence:{note:'PRIVATE-AMENDMENT'}}),
    activity('private-open-id','maya','2026-11-21T13:00','2026-11-21T13:30',{title:'Work with no report',status:'progress',requiresVerification:true}),
    activity('private-archived-id','maya','2026-11-21T14:00','2026-11-21T14:30',{title:'Archived task',status:'done',requiresVerification:true,archivedAt:report}),
    {id:'private-unscheduled-id',owner:'maya',title:'Unscheduled report',status:'progress',requiresVerification:true,reportedAt:report},
  ];
  const before=structuredClone(input);
  for(const [scope,expected,count] of [
    [{},3,4],
    [{date:'2026-11-20'},1,1],
    [{date:'2026-11-21'},3,3],
    [{date:'2026-11-21',mine:true,actor:'maya'},2,2],
    [{date:'2026-11-21',mine:true,actor:'dev'},1,1],
    [{date:'2026-11-21',mine:true,actor:'unknown'},0,0],
    [{date:'2026-11-22'},0,0],
  ]){
    const model=ui.runSheetModel(input,now,scope),print=ui.runSheetMarkup(model),plain=ui.runSheetText(model);
    const notices=model.cautions.filter(message=>message.includes('completion awaiting organizer verification'));
    const expectedNotice=new RegExp(`\\b${expected} ${expected===1?'activity has':'activities have'} completion awaiting organizer verification`);
    assert.equal(notices.length,expected?1:0,JSON.stringify(scope));
    assert.equal(model.days.flatMap(day=>day.rows).filter(row=>row.status==='Awaiting verification').length,count,JSON.stringify(scope));
    assert.equal(print,ui.runSheet(input,now,scope));
    for(const copy of [print,plain]){
      if(expected){
        assert.match(copy,expectedNotice,JSON.stringify(scope));
        assert.match(copy,/this copy does not include completion evidence/);
      }else assert.doesNotMatch(copy,/completion awaiting organizer verification/);
      assert.doesNotMatch(copy,/PRIVATE-|private\.example|private-[a-z-]+-id|Unscheduled report|Archived task|data-review-kind|Scheduled now/);
      if(scope.actor==='maya')assert.doesNotMatch(copy,/Different owner report/);
      if(scope.actor==='dev')assert.doesNotMatch(copy,/Overnight report|Legacy unverified/);
    }
  }
  assert.deepEqual(input,before);
});

test('run sheet escapes entered facts and is stable across viewer time zones',()=>{
  const input=state();input.event.name='<script>EVENT</script>';input.members[0].name='<img src=x>';
  input.tasks[1].title='<svg onload=alert(1)>';input.tasks[1].schedule.location='</td><script>LOCATION</script>';
  const before=process.env.TZ;
  try{
    let expected;
    for(const zone of ['UTC','Asia/Tokyo','Pacific/Auckland']){
      process.env.TZ=zone;const html=ui.runSheet(input,now);
      if(expected)assert.equal(html,expected);expected=html;
      assert.doesNotMatch(html,/<script|<img|<svg/);assert.match(html,/&lt;script&gt;EVENT/);assert.match(html,/&lt;img/);assert.match(html,/&lt;svg/);
    }
  }finally{if(before===undefined)delete process.env.TZ;else process.env.TZ=before;}
});

test('run sheets distinguish unassigned work from inactive or missing assigned owners',()=>{
  const input=state();input.members[0].active=false;
  input.tasks.push(activity('Missing owner','missing-member','2026-11-20T18:00','2026-11-20T18:15'));
  const before=structuredClone(input),html=ui.runSheet(input,now);
  assert.match(html,/Maya Chen · Inactive teammate/);
  assert.match(html,/Assigned owner unavailable/);
  assert.match(html,/3 activities have an assigned owner who cannot accept tasks/);
  assert.match(html,/Confirm responsibility with the organizer/);
  assert.match(html,/>Unassigned<\/td>/);
  assert.doesNotMatch(html,/missing-member|PRIVATE-EMAIL/);
  assert.deepEqual(input,before);
  const mine=ui.runSheet(input,now,{mine:true,actor:'missing-member'});
  assert.match(mine,/My activities · Assigned owner unavailable/);
  assert.match(mine,/1 activity has an assigned owner who cannot accept tasks/);
  assert.doesNotMatch(mine,/Maya Chen|Sound check/);
});

test('owner availability warnings cover only unresolved activities in the selected snapshot',()=>{
  const input=state();input.members[0].active=false;
  input.tasks=input.tasks.map(task=>({...task,status:'done'}));
  let html=ui.runSheet(input,now);
  assert.match(html,/Maya Chen · Inactive teammate/);
  assert.doesNotMatch(html,/activities have an assigned owner who cannot accept tasks/);
  input.tasks[0].requiresVerification=true;
  html=ui.runSheet(input,now);
  assert.match(html,/1 activity has an assigned owner who cannot accept tasks/);
  assert.match(html,/Awaiting verification/);
  input.tasks[0].verifiedAt='2026-11-20T22:05Z';
  assert.doesNotMatch(ui.runSheet(input,now),/activity has an assigned owner who cannot accept tasks/);
  input.members[0].active=true;
  assert.doesNotMatch(ui.runSheet(input,now),/Inactive teammate|Assigned owner unavailable/);
});

test('real-project run sheets flag historical sample assignments without waiting for acceptance from them',()=>{
  const input=state();
  input.members[0].role='Teammate · example';
  const realUI=GatherScheduleUI.create({h,options:()=>'',statusBadge:()=>'',
    assignableTaskOwner:person=>person.active!==false&&!person.role?.includes('· example')});
  const view=realUI.runSheet(input,now);
  assert.match(view,/Maya Chen · Example only · unavailable owner/);
  assert.match(view,/2 activities have an assigned owner who cannot accept tasks/);
  assert.doesNotMatch(view,/Acceptance not recorded/);
  assert.match(ui.runSheet(input,now),/Acceptance not recorded/,'simulation personas can still accept');
});

test('run sheets expose pending responsibility without treating a named owner as acceptance',()=>{
  const input=state(),before=structuredClone(input),html=ui.runSheet(input,now);
  assert.match(html,/2 activities have owner acceptance not recorded/);
  assert.equal((html.match(/<span>Acceptance not recorded<\/span>/g)||[]).length,2);
  assert.match(html,/Assignment alone does not confirm responsibility/);
  assert.match(html,/Maya Chen<span>Acceptance not recorded<\/span><\/td>/);
  assert.match(html,/>Unassigned<\/td>/);
  assert.doesNotMatch(html,/acceptedAt|acceptedBy|data-action/);
  assert.deepEqual(input,before);
  const mine=ui.runSheet(input,now,{mine:true,actor:'maya'});
  assert.match(mine,/2 activities have owner acceptance not recorded/);
});

test('acceptance warnings follow review semantics and only the selected scheduled activities',()=>{
  const input=state();input.members.push({id:'other',name:'Other owner'},{id:'inactive',name:'Former owner',active:false});
  input.tasks=[
    activity('Pending','maya','2026-11-20T17:00'),
    activity('Accepted','maya','2026-11-20T17:15','',{acceptedAt:'2026-11-19T12:00Z'}),
    activity('Reported','maya','2026-11-20T17:30','',{reportedAt:'2026-11-19T12:00Z',requiresVerification:true}),
    activity('Done','maya','2026-11-20T17:45','',{status:'done'}),
    activity('Needs review','maya','2026-11-20T18:00','',{status:'done',requiresVerification:true}),
    activity('Inactive','inactive','2026-11-20T18:15'),
    activity('Unavailable','missing','2026-11-20T18:30'),
    activity('Unassigned','','2026-11-20T18:45'),
    activity('Other pending','other','2026-11-20T19:00'),
    {id:'prep',title:'Preparation acceptance',owner:'maya',status:'todo'},
  ];
  const html=ui.runSheet(input,now,{mine:true,actor:'maya'});
  assert.match(html,/1 activity has owner acceptance not recorded/);
  assert.equal((html.match(/<span>Acceptance not recorded<\/span>/g)||[]).length,1);
  const review=GatherScheduleUI.reviewItems(input,now,{mine:true,actor:'maya'}).find(group=>group.key==='acceptance');
  assert.deepEqual(review.tasks.map(task=>task.id),['Pending','prep']);
  input.tasks[0].acceptedAt='2026-11-19T12:00Z';
  assert.doesNotMatch(ui.runSheet(input,now,{mine:true,actor:'maya'}),/Acceptance not recorded|owner acceptance not recorded/);
});

test('run sheets retain unfinished required work against the whole project without exporting prerequisite details',()=>{
  const input=state();
  input.tasks=[activity('Guest arrival','maya','2026-11-20T17:00','2026-11-20T17:30',{dependencies:[{taskId:'prep',kind:'dependency'},{taskId:'related',kind:'related'}]}),
    {id:'prep',title:'PRIVATE-PREREQUISITE-TITLE',owner:'jack',status:'todo',note:'PRIVATE-PREREQUISITE-NOTE'},
    {id:'related',title:'PRIVATE-RELATED-TITLE',owner:'jack',status:'todo'}];
  const before=structuredClone(input),html=ui.runSheet(input,now,{mine:true,actor:'maya'});
  assert.match(html,/1 activity has unfinished required work/);
  assert.match(html,/<span>Required work not complete<\/span>/);
  assert.match(html,/incomplete, awaiting verification or unavailable/);
  assert.match(html,/does not certify event readiness/);
  assert.doesNotMatch(html,/PRIVATE-PREREQUISITE|PRIVATE-RELATED|data-action/);
  assert.deepEqual(input,before);
  input.tasks[1].status='done';input.tasks[1].requiresVerification=true;
  assert.match(ui.runSheet(input,now,{mine:true,actor:'maya'}),/Required work not complete/);
  input.tasks[1].verifiedAt='2026-11-19T12:00Z';
  assert.doesNotMatch(ui.runSheet(input,now,{mine:true,actor:'maya'}),/unfinished required work|Required work not complete/);
});

test('run-sheet prerequisite warnings are scoped, count activities once and preserve recorded status',()=>{
  const input=state();
  input.tasks=[
    activity('My activity','maya','2026-11-20T17:00','',{status:'progress',dependencies:[{taskId:'missing-a'},{taskId:'missing-b'}]}),
    activity('Other activity','other','2026-11-20T18:00','',{dependencies:[{taskId:'missing-a'}]}),
    activity('Historical done','maya','2026-11-20T19:00','',{status:'done',dependencies:[{taskId:'missing-a'}]}),
    activity('Review pending','maya','2026-11-20T20:00','',{status:'done',requiresVerification:true,dependencies:[{taskId:'missing-a'}]}),
    {id:'prep',title:'Unscheduled work',owner:'maya',status:'todo',dependencies:[{taskId:'missing-a'}]},
  ];
  const html=ui.runSheet(input,now,{mine:true,actor:'maya'});
  assert.match(html,/2 activities have unfinished required work/);
  assert.equal((html.match(/<span>Required work not complete<\/span>/g)||[]).length,2);
  assert.match(html,/>In progress<span>Required work not complete<\/span><\/td>/);
  assert.match(html,/>Awaiting verification<span>Required work not complete<\/span><\/td>/);
  assert.match(html,/>Done<\/td>/);assert.doesNotMatch(html,/Other activity|Unscheduled work|missing-a|missing-b/);
  assert.match(ui.runSheet(input,now),/3 activities have unfinished required work/);
  assert.doesNotMatch(ui.runSheet(input,now,{mine:true,actor:'unknown'}),/unfinished required work|Required work not complete/);
});

test('the text copy and print preview use the same scoped facts, warnings and timestamp',()=>{
  const input=state();
  input.event.name='School dance\nSnapshot: wrong\u202e';
  input.tasks.push(
    activity('Overnight shift','maya','2026-11-20T23:00','2026-11-21T01:00',{status:'done',verifiedAt:'2026-11-19',requiresVerification:true,completionEvidence:{note:'PRIVATE-EVIDENCE'}}),
    activity('Other crew shift','other','2026-11-21T09:00','2026-11-21T10:00'),
    activity('Stage check','maya','2026-11-21T09:15','2026-11-21T09:30',{requiresVerification:true,reportedAt:'2026-11-21T10:00Z'}),
    {id:'untimed',title:'PRIVATE-UNTIMED',owner:'maya',eventActivity:true,status:'todo'});
  input.tasks[0].schedule.location='Hall\u2028Status at snapshot: wrong';
  input.tasks[0].dependencies=[{taskId:'prep',kind:'dependency'}];
  const before=structuredClone(input),model=ui.runSheetModel(input,now,{mine:true,actor:'maya',date:'2026-11-21'});
  assert.deepEqual(input,before);
  input.tasks[0].title='Changed after preview';
  const html=ui.runSheetMarkup(model),text=ui.runSheetText(model);
  for(const label of ['My activities · Maya Chen','2026-11-20 · 15:00 · America/Los_Angeles','Continues from','Awaiting verification','Evidence amended after verification','Required work not complete','Potential location overlap','No end time set','1 planned activity is not shown']){
    assert.ok(html.includes(label),label+' in print preview');assert.ok(text.includes(label),label+' in text');
  }
  assert.match(text,/^EVENT RUN SHEET — TEAM ONLY\nSchool dance Snapshot: wrong\n/);
  assert.match(text,/Location: Hall Status at snapshot: wrong/);
  assert.match(text,/Status at snapshot: Done/);
  assert.match(text,/This copy is not live/);
  assert.doesNotMatch(text+html,/PRIVATE-|PREPARATION-ONLY|Other crew shift|Changed after preview/);
});

function runSheetHarness(){
  const source=readFileSync('legacy/app.js','utf8');
  const start=source.indexOf("      if(action==='run-sheet'");
  const end=source.indexOf("      if(action==='task')",start);
  assert.ok(start>=0&&end>start);
  const fixture={prints:0,printedWarnings:[],opens:[],exists:true,revision:1,downloads:0,revokes:0,blob:null,remote:1,reads:0,refreshes:0,renders:0};
  const staleNotice={hidden:true},fallback={hidden:false},sync={hidden:true},attrs=new Map();
  const copyText={value:''},copyWarnings=Array.from({length:3},()=>({hidden:true,textContent:''}));
  const refreshButton={hidden:true,setAttribute:(key,value)=>attrs.set('refresh:'+key,value)};
  const refreshStatus={textContent:''},checkStatus={textContent:''},printable={dataset:{},toggleAttribute(){},setAttribute(){},removeAttribute(){}};
  const printAttributes=new Set();
  const printBlocked={toggleAttribute(key,active){if(active)printAttributes.add(key);else printAttributes.delete(key);}};
  const heading={focus(){},setAttribute(){}},backdrop={hidden:false,dataset:{}};
  const link={click(){fixture.downloads++;},remove(){}};
  const context=vm.createContext({action:'run-sheet',window:{print(){
    fixture.prints++;
    fixture.printedWarnings.push(copyWarnings.filter(node=>!node.hidden).map(node=>node.textContent));
  }},ui:{view:'timeline',dialogKind:'',scheduleMine:true,scheduleDate:'2026-11-21',actor:'maya'},Date,Blob,h,scheduleWorkspaceKey:()=> 'fictional-project:maya',
    URL:{createObjectURL(value){fixture.blob=value;return 'blob:fixture';},revokeObjectURL(url){assert.equal(url,'blob:fixture');fixture.revokes++;}},setTimeout:callback=>callback(),requestAnimationFrame:callback=>callback(),
    document:{hidden:false,createElement:()=>link,body:{append(){} }},toast:()=>{},render:()=>fixture.renders++,
    store:{getState:()=>({revision:fixture.revision}),getSnapshotRevision:()=>fixture.revision,
      async confirmSnapshotRevision(expected,onNewer){
        fixture.reads++;
        if(fixture.waitForCheck)await fixture.waitForCheck;
        if(fixture.remote>expected)onNewer?.(fixture.remote);
        if(fixture.inconclusiveChecks>0){fixture.inconclusiveChecks--;return false;}
        return expected===fixture.remote;
      },
      async refresh(canApply,{requireFresh}){
        fixture.refreshes++;
        assert.equal(requireFresh,true);
        if(fixture.waitForRefresh)await fixture.waitForRefresh;
        if(!canApply(fixture.remote))return {pending:true,newerRevision:fixture.remote};
        if(fixture.inconclusiveChecks>0){fixture.inconclusiveChecks--;return {changed:false};}
        if(fixture.remote===fixture.revision)return {changed:false,verified:true};
        fixture.revision=fixture.remote;
        return {changed:true,verified:true};
      },
    },schedule:{
      runSheetModel(s,time,scope){return {days:[{}],...scope,day:scope.date,revision:s.revision};},
      runSheetMarkup:model=>'<article>Preview '+model.revision+'</article>',runSheetText:model=>'Frozen '+model.date+' revision '+model.revision,
    },
    openDialog(title,body,footer,wide,kind){
      fixture.opens.push({body,footer});checkStatus.textContent='';copyText.value=context.ui.runSheet.text;
      for(const marker of copyWarnings){marker.hidden=true;marker.textContent='';}
      assert.match(footer,/Download text/);assert.match(footer,/Print \/ save PDF/);assert.match(footer,/Check for updates/);assert.equal(wide,true);context.ui.dialogKind=kind;
    },
    $:selector=>({'#eventRunSheet':fixture.exists?printable:null,'#workspaceSyncNotice':sync,'#runSheetStale':staleNotice,'#runSheetTextFallback':fallback,'#runSheetCopyText':copyText,'#runSheetRefresh':refreshButton,'#runSheetRefreshStatus':refreshStatus,'#runSheetCheckStatus':checkStatus,'#runSheetPrintBlocked':printBlocked,'#dialogTitle':heading,'#dialogBackdrop':backdrop})[selector],
    $$:selector=>selector.includes('[data-run-sheet-update-warning]')?copyWarnings:[{setAttribute:(key,value)=>attrs.set(key,value)}]});
  const helperStart=source.indexOf('  let staleScheduleRevision');
  assert.ok(helperStart>=0);
  vm.runInContext(source.slice(helperStart,source.indexOf('  function dependencyInfo(',helperStart)),context);
  const run=vm.runInContext('(async action=>{'+source.slice(start,end)+'})',context);
  const close=()=>{context.ui.dialogKind='';context.ui.runSheet=null;};
  return {fixture,context,run,close,staleNotice,fallback,sync,attrs,link,source,checkStatus,copyText,copyWarnings,blocksNativePrint:()=>printAttributes.has('data-blocked')};
}

test('run-sheet controls export only the active snapshot and block known newer revisions and lost access',async()=>{
  const {fixture,context,run,close,staleNotice,fallback,sync,attrs,link,source}=runSheetHarness();
  await run('run-sheet');assert.equal(fixture.opens.length,1);assert.equal(fixture.prints,0);
  await run('download-run-sheet');assert.equal(fixture.downloads,1);
  assert.equal(link.download,'weft-run-sheet-my-activities-2026-11-21.txt');
  assert.equal(fixture.blob.type,'text/plain;charset=utf-8');assert.equal(await fixture.blob.text(),'Frozen 2026-11-21 revision 1');assert.equal(fixture.revokes,1);
  assert.equal(fixture.reads,0,'saving the loaded copy works offline and does not make a request');
  await run('check-run-sheet');assert.equal(fixture.reads,1);assert.equal(staleNotice.hidden,true);
  await run('print-run-sheet');assert.equal(fixture.prints,1);
  for(const kind of ['task','']){context.ui.dialogKind=kind;await run('print-run-sheet');assert.equal(fixture.prints,1);}
  context.ui.dialogKind='run-sheet';fixture.exists=false;await run('print-run-sheet');assert.equal(fixture.prints,1);
  fixture.exists=true;fixture.revision++;await run('print-run-sheet');
  assert.equal(fixture.prints,1);assert.equal(staleNotice.hidden,false);assert.equal(attrs.get('aria-disabled'),'true');
  await run('download-run-sheet');assert.equal(fixture.downloads,1);
  close();await run('run-sheet');assert.equal(fixture.opens.length,2);assert.equal(staleNotice.hidden,true);
  fixture.remote=3;await run('check-run-sheet');
  assert.equal(fixture.reads,2);assert.equal(staleNotice.hidden,false);assert.equal(fallback.hidden,true);
  close();await run('run-sheet');assert.equal(fixture.opens.length,3);
  assert.equal(staleNotice.hidden,false,'close/reopen alone cannot clear a remote mismatch');
  assert.equal(fallback.hidden,true);
  await run('print-run-sheet');await run('download-run-sheet');
  assert.equal(fixture.prints,1);assert.equal(fixture.downloads,1);
  fixture.revision=3;
  close();await run('run-sheet');assert.equal(fixture.opens.length,4);assert.equal(staleNotice.hidden,true);
  assert.equal(fallback.hidden,false,'reopening after a newer authorized snapshot restores export');
  sync.hidden=false;await run('download-run-sheet');assert.equal(fixture.downloads,1);
  sync.hidden=true;context.window.GatherAccessLost=true;await run('download-run-sheet');assert.equal(fixture.downloads,1);
  await run('run-sheet');assert.equal(fixture.opens.length,4);
  assert.match(source,/replacesDialog=\[[^\n]*'run-sheet'/);
});

test('run-sheet refresh keeps scope and re-enables exports only after the newer snapshot applies',async()=>{
  const {fixture,context,run,staleNotice,fallback,sync,blocksNativePrint}=runSheetHarness();
  await run('run-sheet');
  fixture.remote=2;await run('check-run-sheet');
  assert.equal(staleNotice.hidden,false);
  // Model a pending workspace notice and UI filters changed elsewhere; the
  // refresh belongs to the exact scope the user opened, not current filters.
  sync.hidden=false;context.ui.scheduleMine=false;context.ui.scheduleDate='2026-11-22';
  const deferred=Promise.withResolvers();fixture.waitForRefresh=deferred.promise;
  const pending=run('refresh-run-sheet');
  assert.equal(fixture.refreshes,1);
  await run('print-run-sheet');await run('download-run-sheet');
  assert.equal(fixture.prints,0);assert.equal(fixture.downloads,0);assert.equal(fallback.hidden,true);
  assert.equal(blocksNativePrint(),true);
  deferred.resolve();await pending;
  assert.equal(fixture.revision,2);assert.equal(fixture.renders,1);assert.equal(fixture.opens.length,2);
  assert.equal(sync.hidden,true);assert.equal(staleNotice.hidden,true);assert.equal(fallback.hidden,false);
  assert.equal(blocksNativePrint(),false);
  assert.deepEqual({...context.ui.runSheet.scope},{mine:true,actor:'maya',date:'2026-11-21'});
  assert.match(fixture.opens.at(-1).body,/<article>Preview 2<\/article>/);
  await run('download-run-sheet');assert.equal(await fixture.blob.text(),'Frozen 2026-11-21 revision 2');
});

test('reopening while the same run-sheet revision is being checked does not bypass the export gate',async()=>{
  const {fixture,run,close,staleNotice,fallback,blocksNativePrint}=runSheetHarness();
  await run('run-sheet');
  assert.match(fixture.opens[0].body,/id="runSheetPrintBlocked"/);
  assert.equal(blocksNativePrint(),false);
  const deferred=Promise.withResolvers();fixture.waitForCheck=deferred.promise;
  const pending=run('check-run-sheet');
  assert.equal(fixture.reads,1);assert.equal(blocksNativePrint(),true);
  close();await run('run-sheet');
  assert.equal(fallback.hidden,true);assert.equal(blocksNativePrint(),true);
  await run('print-run-sheet');await run('download-run-sheet');await run('check-run-sheet');
  assert.deepEqual([fixture.prints,fixture.downloads,fixture.reads],[0,0,1]);
  fixture.remote=4;deferred.resolve();await pending;
  assert.equal(staleNotice.hidden,false,'a late known-newer response applies to the reopened copy');
  assert.equal(fallback.hidden,true);assert.equal(blocksNativePrint(),true);
  await run('print-run-sheet');await run('download-run-sheet');
  assert.deepEqual([fixture.prints,fixture.downloads],[0,0]);
  for(const revision of [2,3]){
    fixture.revision=revision;close();await run('run-sheet');
    assert.equal(staleNotice.hidden,false,'an intermediate revision cannot clear a known revision 4');
    assert.equal(fallback.hidden,true);assert.equal(blocksNativePrint(),true);
    await run('download-run-sheet');assert.equal(fixture.downloads,0);
  }
  fixture.revision=4;close();await run('run-sheet');
  assert.equal(staleNotice.hidden,true);assert.equal(blocksNativePrint(),false);
  await run('download-run-sheet');assert.equal(await fixture.blob.text(),'Frozen 2026-11-21 revision 4');
});

test('an inconclusive run-sheet check can recover by re-confirming the same revision',async()=>{
  const {fixture,run,close,staleNotice,fallback,blocksNativePrint}=runSheetHarness();
  await run('run-sheet');
  fixture.inconclusiveChecks=2;await run('check-run-sheet');
  assert.equal(staleNotice.hidden,false);assert.equal(fallback.hidden,true);assert.equal(blocksNativePrint(),true);
  close();await run('run-sheet');
  assert.equal(staleNotice.hidden,false,'close/reopen does not turn an inconclusive check into a verified copy');
  assert.equal(fallback.hidden,true);assert.equal(blocksNativePrint(),true);
  await run('download-run-sheet');assert.equal(fixture.downloads,0);
  await run('refresh-run-sheet');
  assert.deepEqual([fixture.revision,fixture.reads,fixture.refreshes,fixture.opens.length],[1,1,1,2]);
  assert.equal(fallback.hidden,true);assert.equal(blocksNativePrint(),true);
  await run('refresh-run-sheet');
  assert.deepEqual([fixture.revision,fixture.reads,fixture.refreshes,fixture.opens.length],[1,1,2,3]);
  assert.equal(staleNotice.hidden,true);assert.equal(fallback.hidden,false);assert.equal(blocksNativePrint(),false);
  await run('download-run-sheet');assert.equal(fixture.downloads,1);
});

test('a timed-out run-sheet check releases the offline copy and keeps its caution across reopening until a verified retry',async()=>{
  const {fixture,context,run,close,staleNotice,fallback,checkStatus,copyText,copyWarnings,blocksNativePrint}=runSheetHarness();
  await run('run-sheet');
  assert.match(fixture.opens[0].body,/<p id="runSheetCheckStatus"[^>]*role="status"/);
  assert.match(fixture.opens[0].body,/<textarea[^>]*id="runSheetCopyText"[^>]*readonly/);
  const baseText='Frozen 2026-11-21 revision 1';
  assert.equal(copyText.value,baseText);
  assert.ok(copyWarnings.every(marker=>marker.hidden));
  const deferred=Promise.withResolvers();fixture.waitForCheck=deferred.promise;
  const pending=run('check-run-sheet');
  assert.match(checkStatus.textContent,/Checking the saved plan/);
  assert.equal(fallback.hidden,true);assert.equal(blocksNativePrint(),true);
  assert.equal(copyText.value,'','in-flight checks also block the readonly copy field');
  close();await run('run-sheet');
  assert.match(checkStatus.textContent,/Checking the saved plan/);
  await run('download-run-sheet');
  assert.equal(fixture.downloads,0);

  deferred.reject(new DOMException('Fictional timeout','TimeoutError'));
  await pending;
  const warning='Could not check for updates. This is the last loaded copy; confirm changes with your team before using it.';
  assert.equal(checkStatus.textContent,warning);
  assert.equal(staleNotice.hidden,true,'a timed-out read does not prove the revision changed');
  assert.equal(fallback.hidden,false);assert.equal(blocksNativePrint(),false);
  const warnedText=warning+'\n\n'+baseText;
  assert.equal(copyText.value,warnedText,'manual copy preserves the freshness warning');
  assert.ok(copyWarnings.every(marker=>!marker.hidden&&marker.textContent===warning));
  await run('print-run-sheet');await run('download-run-sheet');
  assert.deepEqual([fixture.prints,fixture.downloads,fixture.reads],[1,1,1]);
  assert.deepEqual(fixture.printedWarnings,[[warning,warning,warning]],'print and continuation headers keep the same warning');
  assert.equal(await fixture.blob.text(),warnedText);
  assert.equal(context.ui.runSheet.text,baseText,'the frozen projection stays unchanged');

  close();await run('run-sheet');
  assert.equal(checkStatus.textContent,warning);
  assert.equal(copyText.value,warnedText,'reopening does not duplicate or clear the warning for this revision');
  fixture.waitForCheck=null;
  await run('check-run-sheet');
  assert.equal(fixture.reads,2);
  assert.doesNotMatch(checkStatus.textContent,/Could not check|Checking the saved plan/);
  assert.equal(staleNotice.hidden,true);
  assert.equal(blocksNativePrint(),false);
  assert.ok(copyWarnings.every(marker=>marker.hidden));
  assert.equal(copyText.value,baseText);
  await run('download-run-sheet');
  assert.equal(await fixture.blob.text(),baseText,'a verified retry clears the warning from downloads');
  assert.equal(fixture.reads,2,'neither offline nor verified exports start another check');
});

test('a failed check never makes an older revision exportable after a newer revision is known',async()=>{
  const {fixture,context,run,staleNotice,fallback,copyText,copyWarnings,blocksNativePrint}=runSheetHarness();
  await run('run-sheet');
  fixture.waitForCheck=Promise.reject(new Error('Fictional network failure'));
  await run('check-run-sheet');
  assert.ok(copyWarnings.every(marker=>!marker.hidden));
  context.rememberNewerSchedule(context.ui.runSheet,fixture.revision+1);
  await run('download-run-sheet');await run('print-run-sheet');
  assert.equal(staleNotice.hidden,false);
  assert.equal(fallback.hidden,true);
  assert.equal(copyText.value,'');
  assert.ok(copyWarnings.every(marker=>marker.hidden));
  assert.equal(blocksNativePrint(),true);
  assert.deepEqual([fixture.reads,fixture.downloads,fixture.prints],[1,0,0]);
});

test('a refresh superseded by reopening cannot expose a snapshot older than its pending result',async()=>{
  const {fixture,context,run,close,staleNotice,fallback,blocksNativePrint}=runSheetHarness();
  await run('run-sheet');
  fixture.inconclusiveChecks=1;await run('check-run-sheet');
  assert.equal(staleNotice.hidden,false);
  const deferred=Promise.withResolvers();fixture.waitForRefresh=deferred.promise;
  const pending=run('refresh-run-sheet');assert.equal(fixture.refreshes,1);
  close();await run('run-sheet');
  const replacement=context.ui.runSheet;
  assert.equal(replacement.revision,1);
  assert.equal(fallback.hidden,true);assert.equal(blocksNativePrint(),true);
  await run('print-run-sheet');await run('download-run-sheet');await run('check-run-sheet');await run('refresh-run-sheet');
  assert.deepEqual([fixture.prints,fixture.downloads,fixture.reads,fixture.refreshes],[0,0,1,1]);
  fixture.remote=2;deferred.resolve();await pending;
  assert.equal(fixture.revision,1,'the old refresh may observe the new revision but must not publish after reopening');
  assert.equal(context.ui.runSheet,replacement);assert.equal(fixture.opens.length,2);assert.equal(fixture.renders,0);
  assert.equal(staleNotice.hidden,false);assert.equal(fallback.hidden,true);assert.equal(blocksNativePrint(),true);
  await run('print-run-sheet');await run('download-run-sheet');
  assert.deepEqual([fixture.prints,fixture.downloads],[0,0]);
  close();await run('run-sheet');assert.equal(staleNotice.hidden,false,'the learned revision floor survives another reopen');
  fixture.revision=2;close();await run('run-sheet');
  assert.equal(staleNotice.hidden,true);assert.equal(blocksNativePrint(),false);
});

test('failed or superseded run-sheet refresh never exports or reopens the frozen copy',async()=>{
  const {fixture,context,run,close,staleNotice,fallback}=runSheetHarness();
  await run('run-sheet');
  fixture.remote=2;await run('check-run-sheet');
  const failing=Promise.withResolvers();fixture.waitForRefresh=failing.promise;
  const failed=run('refresh-run-sheet');
  failing.reject(Error('Fictional network failure'));await failed;
  assert.equal(fixture.opens.length,1);assert.equal(fixture.renders,0);
  assert.equal(staleNotice.hidden,false);assert.equal(fallback.hidden,true);
  await run('print-run-sheet');await run('download-run-sheet');
  assert.equal(fixture.prints,0);assert.equal(fixture.downloads,0);
  const deferred=Promise.withResolvers();fixture.waitForRefresh=deferred.promise;
  const pending=run('refresh-run-sheet');assert.equal(fixture.refreshes,2);
  close();context.ui.dialogKind='task';
  deferred.resolve();await pending;
  assert.equal(fixture.revision,1,'the guarded refresh cannot apply after the run-sheet closes');
  assert.equal(fixture.opens.length,1);assert.equal(fixture.renders,0);
  assert.equal(context.ui.dialogKind,'task');assert.equal(context.ui.runSheet,null);
});

test('print isolation hides every other body surface, retains table headers and removes dialog chrome',()=>{
  const css=readFileSync('legacy/styles.css','utf8');
  const source=readFileSync('legacy/app.js','utf8');
  assert.match(css,/@media print\{/);
  assert.match(css,/^#eventRunSheet \[data-run-sheet-update-warning\]\{display:none\}/m);
  assert.match(css,/@media print\{[\s\S]*#eventRunSheet \[data-run-sheet-update-warning\]:not\(\[hidden\]\)\{display:block/);
  assert.match(css,/body:has\(#eventRunSheet\)>:not\(#dialogBackdrop\)\{display:none!important\}/);
  assert.match(css,/#eventRunSheet thead\{display:table-header-group\}/);
  assert.match(css,/#eventRunSheet tr\{break-inside:avoid\}/);
  assert.match(css,/body:has\(#eventRunSheet\) \.dialog-footer[^}]*display:none!important/);
  assert.match(css,/body:has\(#eventRunSheet\) #dialog\{[^}]*overflow:visible!important/);
  assert.match(css,/^#runSheetPrintBlocked\{display:none\}/m);
  assert.match(css,/@media print\{[\s\S]*body:has\(#runSheetPrintBlocked\[data-blocked\]\) #eventRunSheet\{display:none!important\}/);
  assert.match(css,/@media print\{[\s\S]*body:has\(#eventRunSheet\) #runSheetPrintBlocked\[data-blocked\]\{display:block!important\}/);
  assert.match(source,/window\.addEventListener\('beforeprint',[^\n]*currentRunSheet\(\)/);
});

test('phone run sheets stack labeled facts without changing the print table',()=>{
  const html=ui.runSheet(state(),now),css=readFileSync('legacy/styles.css','utf8');
  for(const label of ['Time','Owner','Status at snapshot'])assert.ok(html.includes('data-label="'+label+'"'));
  assert.match(css,/@media screen and \(max-width:640px\)/);
  assert.match(css,/\.run-sheet-table\{min-width:0\}/);
  assert.match(css,/content:attr\(data-label\)/);
  assert.match(html,/<th scope="col">Owner<\/th>/);assert.match(html,/<th scope="row">Check-in/);
});

test('every printed continuation header identifies event, day, scope and snapshot time',()=>{
  const input=state(),html=ui.runSheet(input,now,{mine:true,actor:'maya'});
  const heads=[...html.matchAll(/<thead>([\s\S]*?)<\/thead>/g)].map(match=>match[1]);
  assert.equal(heads.length,2);
  for(const head of heads){
    assert.match(head,/run-sheet-repeat-heading/);assert.match(head,/School dance/);
    assert.match(head,/My activities · Maya Chen/);assert.match(head,/2026-11-20 · 15:00 · America\/Los_Angeles/);
    assert.match(head,/All activity times: America\/Los_Angeles/);
    assert.match(head,/Team only · Not live · Snapshot:/);
  }
  assert.match(heads[0],/Fri, Nov 20, 2026/);assert.match(heads[1],/Sat, Nov 21, 2026/);
  const css=readFileSync('legacy/styles.css','utf8');
  assert.match(css,/\.run-sheet-repeat-heading\{display:none\}/);
  assert.match(css,/#eventRunSheet \.run-sheet-repeat-heading\{display:table-row\}/);
  assert.match(css,/#eventRunSheet caption\{display:none\}/);
});
