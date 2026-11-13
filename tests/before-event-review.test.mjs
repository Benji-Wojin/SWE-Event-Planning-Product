import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/schedule-ui.js';

const now='2026-10-03T16:30:00Z';
const event={name:'School dance',date:'2026-10-03',location:'Hall',timeZone:'America/Los_Angeles'};
const members=[{id:'jack',name:'Jack'},{id:'maya',name:'Maya'},{id:'old',name:'Former owner',active:false}];
const task=(id,extra={})=>({id,title:id,owner:'jack',status:'todo',dueDate:'',schedule:null,dependencies:[],...extra});
const slot=(start='09:00',end='10:00',location='Hall')=>({start:'2026-10-03T'+start,end:end?'2026-10-03T'+end:'',location});
const state=tasks=>({event,members,tasks});
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui=GatherScheduleUI.create({h,options:()=>'',person:()=>{throw Error('No profile HTML needed');},statusBadge:()=>{throw Error('No badge HTML needed');}});
const groups=(s,scope={})=>Object.fromEntries(GatherScheduleUI.reviewItems(s,now,scope).map(group=>[group.key,group.tasks.map(t=>t.id)]));
const linked=html=>[...html.matchAll(/data-action="task" data-id="([^"]+)"/g)].map(m=>m[1]);

test('before-event review classifies saved facts without implying completion or changing state',()=>{
  const s=state([task('open'),task('no-owner',{owner:''}),task('inactive',{owner:'old'}),task('missing',{owner:'gone'}),
    task('accepted',{acceptedAt:now}),task('late',{dueDate:'2026-10-02'}),task('today',{dueDate:'2026-10-03'}),
    task('blocked',{status:'blocked'}),task('done',{status:'done'}),
    task('activity',{schedule:slot()}),task('overlap',{schedule:slot('09:30','10:30')}),task('details',{schedule:slot('11:00','','')})]);
  const before=structuredClone(s),g=groups(s);
  assert.deepEqual(g.preparation,['open','no-owner','inactive','missing','accepted','late','today','blocked']);
  assert.deepEqual(g.unassigned,['no-owner']);assert.deepEqual(g['owner-unavailable'],['inactive','missing']);
  assert.deepEqual(g.overdue,['late']);assert.deepEqual(g.blocked,['blocked']);
  assert.deepEqual(g.overlaps,['activity','overlap']);assert.deepEqual(g['activity-details'],['details']);
  assert(!g.acceptance.includes('accepted'));assert(!g.acceptance.includes('inactive'));assert(!g.acceptance.includes('missing'));
  ui.preparationReview(s,now);assert.deepEqual(s,before);
});

test('required verification is unresolved even for a legacy done record; verified work is excluded',()=>{
  const s=state([task('reported',{requiresVerification:true,status:'progress',reportedAt:now}),
    task('legacy-done',{requiresVerification:true,status:'done'}),
    task('verified',{requiresVerification:true,status:'done',reportedAt:now,verifiedAt:now}),task('normal-done',{status:'done'})]);
  const g=groups(s);assert.deepEqual(g.verification,['reported','legacy-done']);assert.deepEqual(g.preparation,[]);
  assert.deepEqual(g.acceptance,[]);assert.deepEqual(linked(ui.preparationReview(s,now)),['reported','legacy-done']);
});

test('before-event completion and amendment rows route only organizers to the existing review',()=>{
  const amended=task('amended"<>',{title:'Fictional <updated evidence>',owner:'jack',status:'done',
    schedule:slot(),requiresVerification:true,reportedAt:now,verifiedAt:now,
    completionEvidence:{note:'PRIVATE-AMENDMENT-NOTE',links:['https://example.com/private-evidence'],fileIds:['PRIVATE-FILE-ID']}});
  const pending=task('reported',{owner:'jack',status:'progress',requiresVerification:true,reportedAt:now,
    dependencies:[{taskId:'other-required',kind:'dependency'}],note:'PRIVATE-REPORT-NOTE'});
  const legacy=task('legacy-done',{owner:'jack',status:'done',requiresVerification:true});
  const other=task('other-reported',{owner:'maya',status:'progress',requiresVerification:true,reportedAt:now});
  const prerequisite=task('other-required',{owner:'maya',status:'todo'});
  const s=state([amended,pending,legacy,other,prerequisite]),before=structuredClone(s);
  const group=(html,title)=>[...html.matchAll(/<details class="before-event-group"[^>]*><summary>([^<]*)<\/summary>([\s\S]*?)<\/details>/g)]
    .find(([,heading])=>heading.startsWith(title+' · '))?.[2]||'';
  const reviewRoutes=html=>[...html.matchAll(/data-action="review-organizer-item" data-id="([^"]+)" data-review-kind="([^"]+)"/g)]
    .map(([,id,kind])=>[id,kind]);
  const mine={mine:true,actor:'jack'};
  const organizer=ui.preparationReview(s,now,mine,true);
  const completionRows=group(organizer,'Completion needs verification');
  const amendmentRows=group(organizer,'Evidence amended after verification');
  assert.deepEqual(reviewRoutes(completionRows),[[pending.id,'completion']]);
  assert.deepEqual(reviewRoutes(amendmentRows),[[h(amended.id),'amendment']]);
  assert.deepEqual(reviewRoutes(organizer),[[pending.id,'completion'],[h(amended.id),'amendment']],
    'a pending task in another group gets only the generic task route there');
  assert.deepEqual(linked(completionRows),[legacy.id],'historical Done with no report has no review action');
  assert.match(amendmentRows,/Fictional &lt;updated evidence&gt;/);
  assert.doesNotMatch(organizer,/other-reported|other-required/);
  assert.ok(reviewRoutes(ui.preparationReview(s,now,{},true)).some(([id,kind])=>id===other.id&&kind==='completion'));

  const teammate=ui.preparationReview(s,now,mine,false);
  assert.deepEqual(reviewRoutes(teammate),[]);
  assert.deepEqual(linked(group(teammate,'Completion needs verification')),[pending.id,legacy.id]);
  assert.deepEqual(linked(group(teammate,'Evidence amended after verification')),[h(amended.id)]);
  for(const html of [organizer,teammate]){
    assert.doesNotMatch(html,/PRIVATE-|private-evidence|<form|data-action="(?:verify-task|review-completion-evidence|toggle-task|report-task|return-completion)"/);
  }
  assert.deepEqual(s,before);
});

test('prerequisites use actual linked completion and verification, not related links or guessed dates',()=>{
  const s=state([task('required',{status:'done',requiresVerification:true}),task('done',{status:'done'}),
    task('blocked-link',{dependencies:[{taskId:'required',kind:'dependency'}]}),
    task('unavailable',{dependencies:[{taskId:'gone'}]}),task('ready',{dependencies:[{taskId:'done',kind:'dependency'}]}),
    task('related',{dependencies:[{taskId:'gone',kind:'related'}]})]);
  assert.deepEqual(groups(s).prerequisites,['blocked-link','unavailable']);
  s.tasks[0].verifiedAt=now;assert.deepEqual(groups(s).prerequisites,['unavailable']);
});

test('My tasks scopes preparation and overlaps while resolving required work against the full plan',()=>{
  const s=state([task('mine',{owner:'maya',dependencies:[{taskId:'other-done',kind:'dependency'}]}),
    task('other-done',{status:'done'}),task('other-open'),task('mine-slot',{owner:'maya',schedule:slot()}),
    task('other-slot',{schedule:slot()}),task('unassigned',{owner:''})]);
  const mine=groups(s,{mine:true,actor:'maya'});assert.deepEqual(mine.preparation,['mine']);
  assert.deepEqual(mine.prerequisites,[]);assert.deepEqual(mine.overlaps,[]);
  const html=ui.preparationReview(s,now,{mine:true,actor:'maya'});
  assert.match(html,/My tasks · Maya/);assert(!linked(html).some(id=>id.startsWith('other')));
  assert.deepEqual(GatherScheduleUI.reviewItems(s,now,{mine:true}).flatMap(g=>g.tasks),[]);
});

test('overdue dates use the event day, never the viewer day or an invalid time zone',()=>{
  const s=state([task('yesterday',{dueDate:'2026-10-02'}),task('today',{dueDate:'2026-10-03'})]);
  const at='2026-10-04T01:00:00Z';
  const overdue=zone=>GatherScheduleUI.reviewItems({...s,event:{...event,timeZone:zone}},at).find(g=>g.key==='overdue').tasks.map(t=>t.id);
  assert.deepEqual(overdue('America/Los_Angeles'),['yesterday']);assert.deepEqual(overdue('UTC'),['yesterday','today']);
  assert.deepEqual(overdue(''),[]);assert.deepEqual(overdue('Invalid/Zone'),[]);
});

test('review projects only safe task and event facts, escapes labels and makes no readiness claim',()=>{
  const s=state([task('id"<>',{title:'<img src=x>',note:'PRIVATE_NOTE',comments:[{text:'SECRET_COMMENT'}],completionResult:{text:'PRIVATE_RESULT'},owner:''})]);
  s.event={...event,name:'<script>event</script>',location:'<b>Hall</b>'};s.privateRecords=[{secret:'PRIVATE_BOOKING'}];
  const before=structuredClone(s),html=ui.preparationReview(s,now);
  assert.match(html,/&lt;script&gt;event/);assert.match(html,/&lt;img src=x&gt;/);assert.match(html,/id&quot;&lt;&gt;/);assert.match(html,/&lt;b&gt;Hall/);
  assert.doesNotMatch(html,/<script|<img|PRIVATE_|SECRET_|<form|toggle-task|report-task|data-action="claim"/);
  assert.match(html,/does not certify safety, approvals, bookings or event readiness/);assert.match(html,/more than one section/);assert.match(html,/Reopen this review to refresh/);
  assert.deepEqual(s,before);
});

test('empty plans and missing context are explicit, not an all-clear',()=>{
  const s={event:{},members:[],tasks:[]};const html=ui.preparationReview(s,now);
  assert.match(html,/No tasks in this plan yet/);assert.match(html,/Event date not entered/);assert.match(html,/Event location not entered/);assert.match(html,/time zone not set or unavailable/);
  assert.match(ui.preparationReview(s,now,{mine:true,actor:'maya'}),/does not mean the whole event is ready/);
  assert.deepEqual(linked(html),[]);assert.doesNotMatch(html,/100%|All clear|Everything is ready/);
});

test('every event review disclosure carries its stable group key, including empty groups',()=>{
  const s=state([task('fictional-preparation'),task('fictional-pending',{reportedAt:now,requiresVerification:true,status:'progress'})]);
  const html=ui.preparationReview(s,now,{mine:true,actor:'jack'},true);
  const keys=[...html.matchAll(/<details\b[^>]*\bdata-event-review-group="([^"]+)"/g)].map(([,key])=>key);
  assert.deepEqual(keys,GatherScheduleUI.reviewItems(s,now,{mine:true,actor:'jack'}).map(group=>group.key));
  assert.equal(new Set(keys).size,keys.length);
  assert.match(html,/<details[^>]*data-event-review-group="verification"[^>]*\bopen(?:\s|>)[\s\S]*?Completion needs verification · 1/);
  assert.match(html,/<details[^>]*data-event-review-group="evidence-amendments"[^>]*><summary>Evidence amended after verification · 0/);
});

test('organizer review offers direct scheduling only for scoped activities that still need details',()=>{
  const pending=task('pending',{title:'Arrival <desk>',owner:'maya',eventActivity:true,revision:4});
  const partial=task('partial',{owner:'maya',revision:2,schedule:slot('09:30','','')});
  const s=state([pending,partial,task('other',{eventActivity:true,revision:1}),task('prep',{owner:'maya'}),task('complete-details',{owner:'maya',schedule:slot()})]);
  const scope={mine:true,actor:'maya'};
  const member=ui.preparationReview(s,now,scope),organizer=ui.preparationReview(s,now,scope,true);
  assert.doesNotMatch(member,/data-action="schedule-review-activity"/);
  assert.match(organizer,/data-action="schedule-review-activity" data-id="pending" aria-label="Set start time for Arrival &lt;desk&gt;"/);
  assert.match(organizer,/data-action="schedule-review-activity" data-id="partial" aria-label="Review timing and location for partial"/);
  assert.equal((organizer.match(/data-action="schedule-review-activity"/g)||[]).length,2);
  assert.match(ui.activityReviewForm(s,'pending'),/id="reviewScheduleForm" data-id="pending" data-revision="4"/);
  const form=ui.activityReviewForm(s,'partial');
  assert.match(form,/value="2026-10-03T09:30"/);assert.doesNotMatch(form,/name="taskId"|Remove from schedule/);
  assert.match(ui.activityReviewForm({...s,event:{...event,timeZone:''}},'pending'),/Set the event time zone/);
  for(const id of ['missing','prep','complete-details'])assert.throws(()=>ui.activityReviewForm(s,id),/Reopen the event review/);
});

test('the event review routes only actionable owner gaps to assignment and never widens My tasks',()=>{
  const s=state([task('unowned',{owner:''}),task('former',{owner:'old',schedule:slot()}),
    task('missing',{owner:'missing-member'}),task('active',{owner:'maya'}),
    task('reported',{owner:'',requiresVerification:true,reportedAt:now}),
    task('completed',{owner:'old',status:'done'})]);
  const pick=(scope,key)=>ui.reviewAssignmentTasks(s,scope,key).map(item=>item.id);
  assert.deepEqual(pick({},'unassigned'),['unowned']);
  assert.deepEqual(pick({},'owner-unavailable'),['former','missing']);
  assert.deepEqual(pick({mine:true,actor:'maya'},'unassigned'),[]);
  assert.deepEqual(pick({mine:true,actor:'maya'},'owner-unavailable'),[]);
  assert.deepEqual(pick({},'acceptance'),[]);
  const actions=markup=>markup.match(/data-action="review-event-assignments"/g)||[];
  assert.equal(actions(ui.preparationReview(s,now,{},true)).length,2);
  assert.equal(actions(ui.preparationReview(s,now,{mine:true,actor:'maya'},true)).length,0);
  assert.equal(actions(ui.preparationReview(s,now)).length,0);
});

test('review offers acceptance only for the current active owner, including when all tasks are shown',()=>{
  const s=state([task('mine',{owner:'maya',eventActivity:true}),
    task('other',{owner:'jack',schedule:slot()}),task('unowned',{owner:''}),
    task('reported',{owner:'maya',reportedAt:now,requiresVerification:true}),
    task('accepted',{owner:'maya',acceptedAt:now}),task('completed',{owner:'maya',status:'done'}),
    task('inactive',{owner:'old'})]);
  for(const mine of [false,true]){
    const scope={mine,actor:'maya'};
    assert.deepEqual(ui.reviewAcceptanceTasks(s,scope).map(task=>task.id),['mine']);
    const html=ui.preparationReview(s,now,scope);
    assert.match(html,/data-action="review-event-acceptance">Review my assignments \(1\)/);
  }
  assert.deepEqual(ui.reviewAcceptanceTasks(s,{}),[]);
  assert.deepEqual(ui.reviewAcceptanceTasks(s,{actor:'old'}),[]);
  assert.doesNotMatch(ui.preparationReview(s,now,{actor:'old'}),/data-action="review-event-acceptance"/);
});

test('real store changes recompute the review only from recorded acceptance and completion',()=>{
  const store=GatherStore.createStore({storage:null});store.completeSetup(event);
  const item=store.addTask({title:'Check school hall',owner:'maya',requiresVerification:true});
  const contains=key=>GatherScheduleUI.reviewItems(store.getState(),now).find(g=>g.key===key).tasks.some(t=>t.id===item.id);
  assert(contains('acceptance'));store.acceptTask(item.id,'maya');assert(!contains('acceptance'));
  assert(contains('preparation'));store.reportCompletion(item.id,'Hall inspected.','maya');assert(!contains('preparation'));assert(contains('verification'));
  store.verifyTask(item.id,'jack');assert(!contains('verification'));assert(!contains('preparation'));
});

test('review handler uses current scope, blocks lost access, and participates in dialog discard protection',()=>{
  const source=readFileSync('legacy/app.js','utf8'),start=source.indexOf('  function eventReviewScope(');
  const fragment=source.slice(start,source.indexOf('  function showPendingUpdate(',start));const calls=[];
  const context=vm.createContext({action:'before-event-review',window:{GatherAccessLost:false},Date,$:()=>null,
    requestAnimationFrame:()=>{},isOrganizer:()=>false,scheduleWorkspaceKey:()=> 'fixture',
    ui:{timelineMode:'schedule',scheduleMine:true,actor:'maya'},store:{getState:()=>({marker:true})},
    schedule:{preparationReview(s,now,scope,organizer){calls.push({...scope});assert.equal(s.marker,true);assert.equal(organizer,false);return 'review';}},
    openDialog(title,body,footer,wide,kind){assert.equal(title,'Before the event');assert.equal(body,'review');assert.equal(kind,'before-event-review');}});
  vm.runInContext(fragment+'beforeEventReview();',context);assert.deepEqual(calls,[{mine:true,actor:'maya'}]);
  context.ui.timelineMode='deadlines';vm.runInContext('beforeEventReview();',context);assert.deepEqual(calls[1],{mine:false,actor:'maya'});
  context.window.GatherAccessLost=true;vm.runInContext('beforeEventReview();',context);assert.equal(calls.length,2);
  assert.match(source,/replacesDialog=\[[^\n]*'schedule-review-activity'[^\n]*'before-event-review'/);assert.match(source,/data-action="before-event-review">Before the event/);
});

test('returning to an event review opens and focuses the original group on current scoped facts',()=>{
  const source=readFileSync('legacy/app.js','utf8'),start=source.indexOf('  function eventReviewScope(');
  const fragment=source.slice(start,source.indexOf('  function showPendingUpdate(',start));
  const store=GatherStore.createStore({storage:null});store.completeSetup(event);
  const item=store.addTask({title:'Fictional hall handover',owner:'maya',requiresVerification:true});
  store.reportCompletion(item.id,'Hall checked.','maya');
  const other=store.addTask({title:'Other owner’s fictional handover',owner:'jack',requiresVerification:true});
  store.reportCompletion(other.id,'Other hall checked.','jack');
  const activeUI={timelineMode:'schedule',scheduleMine:true,actor:'maya',dialogKind:'task'};
  const frames=[],dialog={},sync={hidden:true};
  let activeElement,markup='',groupsInDialog=[],title;
  const focusable=(textContent)=>({textContent,focus(){activeElement=this;},scrollIntoView(options){this.scrollOptions=options;}});
  const context=vm.createContext({window:{GatherAccessLost:false},ui:activeUI,store,schedule:ui,Date,
    isOrganizer:()=>false,scheduleWorkspaceKey:()=> 'fixture',requestAnimationFrame:frame=>frames.push(frame),
    $(selector,root){if(selector==='#dialog')return dialog;if(selector==='#workspaceSyncNotice')return sync;assert.equal(selector,'#dialogTitle');if(root)assert.equal(root,dialog);return title;},
    $$(selector,root){assert.equal(selector,'[data-event-review-group]');assert.equal(root,dialog);return groupsInDialog;},
    openDialog(label,body,_footer,_wide,kind,focusHeading){
      assert.equal(label,'Before the event');assert.equal(kind,'before-event-review');
      activeUI.dialogKind=kind;markup=body;title=focusable(label);
      assert.equal(focusHeading,true);
      const openedTitle=title;
      frames.push(()=>{if(title===openedTitle&&activeUI.dialogKind===kind)title.focus();});
      groupsInDialog=[...body.matchAll(/<details\b([^>]*)\bdata-event-review-group="([^"]+)"([^>]*)><summary>([^<]*)<\/summary>/g)]
        .map(([,before,key,after,text])=>{
          const summary=focusable(text);
          return {dataset:{eventReviewGroup:key},open:/\bopen\b/.test(before+after),summary,querySelector(selector){assert.equal(selector,'summary');return summary;}};
        });
    },
  });
  vm.runInContext(fragment,context);
  const group=key=>groupsInDialog.find(row=>row.dataset.eventReviewGroup===key);
  const nextFrame=()=>{for(const frame of frames.splice(0))frame();};
  context.beforeEventReview();nextFrame();
  assert.equal(activeElement,title);
  assert.match(markup,/My tasks · Maya/);
  assert.match(markup,/Fictional hall handover/);
  assert.doesNotMatch(markup,/dialogStaleNotice/);
  assert.doesNotMatch(markup,/Other owner’s fictional handover/);
  assert.equal(group('verification').open,true);

  store.verifyTask(item.id,'jack');
  const beforeReturn=store.exportState();
  context.beforeEventReview('verification');nextFrame();
  assert.match(markup,/My tasks · Maya/);
  assert.doesNotMatch(markup,/Other owner’s fictional handover|Fictional hall handover/);
  assert.equal(group('verification').open,true,'the original group reopens even if it is now empty');
  assert.equal(activeElement,group('verification').summary);
  assert.equal(activeElement.textContent,'Completion needs verification · 0');
  assert.equal(activeElement.scrollOptions.block,'center');
  assert.equal(store.exportState(),beforeReturn);

  sync.hidden=false;
  context.beforeEventReview('verification');nextFrame();
  assert.match(markup,/id="dialogStaleNotice"[\s\S]*Newer project changes are available\. This review shows the last loaded plan\./);
  assert.match(markup,/data-action="reload-workspace">Reload project/);
  assert.equal(activeElement,title,'the pending update notice stays in view instead of jumping below it');
  assert.equal(group('verification').open,true);
  assert.equal(store.exportState(),beforeReturn);
  sync.hidden=true;
  context.beforeEventReview('unknown-group');nextFrame();
  assert.equal(activeElement,title);
  assert.equal(group('verification').open,false);
  context.beforeEventReview('verification');
  activeUI.dialogKind='task';const replacement=focusable('Different dialog');replacement.focus();
  nextFrame();assert.equal(activeElement,replacement,'a superseded review callback must not steal focus');
  context.beforeEventReview('verification');context.beforeEventReview();
  nextFrame();assert.equal(activeElement,title);assert.equal(group('verification').open,false,'an older callback cannot reopen the group in a newer review');
});

test('Back to event review obeys the delegated discard prompt and never leaves a different task context',async()=>{
  const source=readFileSync('legacy/app.js','utf8');
  const start=source.indexOf("  document.addEventListener('click',async event=>{");
  const end=source.indexOf("      if(action==='continue-task-search')",start);
  const returnStart=source.indexOf('  function returnToEventTaskReview(');
  const calls=[],dialog={},ui={view:'timeline',actor:'maya',dialogKind:'task',eventTaskReview:{actor:'maya',group:'verification'}};
  const button={dataset:{action:'return-to-event-task-review'},closest:()=>dialog};
  let click,allow=false;
  const context=vm.createContext({ui,window:{},$:(selector)=>selector==='#dialog'?dialog:null,
    document:{addEventListener(type,handler){assert.equal(type,'click');click=handler;}},
    hasAcceptanceReturnDraft:()=>false,confirmDiscard(root,other){assert.equal(root,dialog);assert.equal(other,null);calls.push('confirm');return allow;},
    beforeEventReview(group){calls.push(group);ui.dialogKind='before-event-review';ui.eventTaskReview=null;},
  });
  vm.runInContext(source.slice(returnStart,source.indexOf('  function showPendingUpdate(',returnStart))+
    source.slice(start,end)+'} finally {release();}});',context);
  const back=()=>click({target:{closest:()=>button}});
  await back();assert.deepEqual(calls.splice(0),['confirm']);assert.equal(ui.dialogKind,'task');assert.equal(ui.eventTaskReview.group,'verification');
  allow=true;
  for(const [object,key,value] of [[context.window,'GatherAccessLost',true],[ui,'actor','jack'],[ui,'view','overview'],[ui,'dialogKind','notifications']]){
    const previous=object[key];object[key]=value;
    assert.equal(context.returnToEventTaskReview(),false);assert.deepEqual(calls,[]);
    object[key]=previous;
  }
  await back();assert.deepEqual(calls,['confirm','verification']);assert.equal(ui.dialogKind,'before-event-review');assert.equal(ui.eventTaskReview,null);
});
