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

test('real store changes recompute the review only from recorded acceptance and completion',()=>{
  const store=GatherStore.createStore({storage:null});store.completeSetup(event);
  const item=store.addTask({title:'Check school hall',owner:'maya',requiresVerification:true});
  const contains=key=>GatherScheduleUI.reviewItems(store.getState(),now).find(g=>g.key===key).tasks.some(t=>t.id===item.id);
  assert(contains('acceptance'));store.acceptTask(item.id,'maya');assert(!contains('acceptance'));
  assert(contains('preparation'));store.reportCompletion(item.id,'Hall inspected.','maya');assert(!contains('preparation'));assert(contains('verification'));
  store.verifyTask(item.id,'jack');assert(!contains('verification'));assert(!contains('preparation'));
});

test('review handler uses current scope, blocks lost access, and participates in dialog discard protection',()=>{
  const source=readFileSync('legacy/app.js','utf8'),start=source.indexOf("      if(action==='before-event-review'");
  const fragment=source.slice(start,source.indexOf('\n',start));const calls=[];
  const context=vm.createContext({action:'before-event-review',window:{GatherAccessLost:false},Date,
    ui:{timelineMode:'schedule',scheduleMine:true,actor:'maya'},store:{getState:()=>({marker:true})},
    schedule:{preparationReview(s,now,scope){calls.push({...scope});assert.equal(s.marker,true);return 'review';}},
    openDialog(title,body,footer,wide,kind){assert.equal(title,'Before the event');assert.equal(body,'review');assert.equal(kind,'before-event-review');}});
  vm.runInContext(fragment,context);assert.deepEqual(calls,[{mine:true,actor:'maya'}]);
  context.ui.timelineMode='deadlines';vm.runInContext(fragment,context);assert.deepEqual(calls[1],{mine:false,actor:'maya'});
  context.window.GatherAccessLost=true;vm.runInContext(fragment,context);assert.equal(calls.length,2);
  assert.match(source,/replacesDialog=\[[^\n]*'before-event-review'/);assert.match(source,/data-action="before-event-review">Before the event/);
});
