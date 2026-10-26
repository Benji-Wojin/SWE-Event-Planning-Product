import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/priorities.js';
import '../legacy/schedule-ui.js';
import '../legacy/completion-ui.js';
const now='2026-10-03T16:30:00Z',event={name:'Fictional school dance',date:'2026-10-03',location:'Hall',timeZone:'America/Los_Angeles'};
const review={note:'PRIVATE_REVIEW_REASON',actor:'jack',at:now,reportedAt:now,reportedBy:'PRIVATE_REPORTER'};
const slot={start:'2026-10-03T09:00',end:'2026-10-03T10:00',location:'Hall'};
const task=(id,extra={})=>({id,title:id,owner:'maya',status:'progress',acceptedAt:now,updatedAt:now,dueDate:'',dependencies:[],completionReview:review,...extra});
const state=tasks=>({event,members:[{id:'jack',name:'Jack'},{id:'maya',name:'Maya'}],tasks});
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui=GatherScheduleUI.create({h,options:()=>'',person:id=>h(id),statusBadge:status=>'<span>'+h(status)+'</span>'});
const changed=(s,scope={})=>GatherScheduleUI.reviewItems(s,now,scope).find(g=>g.key==='changes').tasks;
const rank=tasks=>GatherPriorities.rank(tasks,new Date(now),false,event.timeZone).map(t=>t.id);

test('returned completion remains in attention without a deadline, including deferred check-ins and unfinished required work',()=>{
  const item=task('returned',{planReviewAfter:'2099-01-01',followupAfter:'2099-01-01',priority:'low',dependencies:[{taskId:'missing'}]});
  const before=structuredClone(item),info=GatherPriorities.analyze(item,[item],new Date(now),event.timeZone);
  assert.equal(info.key,'changes');assert.equal(info.label,'Changes requested');assert.match(info.action,/revise and resubmit/);assert.equal(info.waiting,true);
  assert.deepEqual(rank([item]),['returned']);assert.equal(GatherPriorities.actionable(item,[item]),false,'attention does not bypass prerequisites');
  assert.deepEqual(item,before);assert.equal(rank([task('ordinary',{completionReview:null,planReviewAfter:'2099-01-01',followupAfter:'2099-01-01'})]).length,0);
});
test('new reports and completed records never display an obsolete active request',()=>{
  for(const extra of [{reportedAt:now,requiresVerification:true},{status:'done',requiresVerification:true},{status:'done',verifiedAt:now},{status:'done'},{completionReview:null},{completionReview:undefined}]){
    const item=task('historical',extra),s=state([item]);
    assert.equal(GatherPriorities.changesRequested(item),false);assert.equal(changed(s).length,0);
    assert.doesNotMatch(ui.runSheet({...s,tasks:[{...item,schedule:slot}]},now),/completion changes requested|<span>Changes requested/);
    assert.doesNotMatch(GatherCompletionUI.section(item,false),/Completion changes requested/);
  }
});
test('real report-return-progress-resubmit-verify lifecycle updates every saved-fact view without a rendering mutation',()=>{
  const store=GatherStore.createStore({storage:null});store.completeSetup(event);
  const item=store.addTask({title:'Fictional welcome route',owner:'maya',requiresVerification:true,scope:'Named greeter and accessible entrance.',schedule:slot});
  store.acceptTask(item.id,'maya');store.reportCompletion(item.id,'Entrance checked; greeter missing.','maya');
  const current=()=>store.getState().tasks.find(t=>t.id===item.id),s=()=>store.getState();
  assert.equal(changed(s()).some(t=>t.id===item.id),false);
  store.returnCompletion(item.id,'Name the greeter before resubmitting.');
  for(const step of ['returned','progress']){
    if(step==='progress')store.updateTask(item.id,{status:'progress',note:'Confirming the greeter now.'},'maya');
    const before=store.exportState();
    assert.ok(rank(s().tasks).includes(item.id));assert.ok(changed(s()).some(t=>t.id===item.id));
    assert.match(ui.view(s(),true,Date.parse(now)),/Changes requested/);assert.match(ui.runSheet(s(),now),/completion changes requested/);
    assert.match(GatherCompletionUI.section(current(),true),/Completion changes requested/);assert.equal(store.exportState(),before);
  }
  store.reportCompletion(item.id,'Greeter named and entrance checked.','maya');
  assert.equal(changed(s()).some(t=>t.id===item.id),false);assert.equal(GatherPriorities.analyze(current(),s().tasks,new Date(now),event.timeZone).key,'verification');
  assert.doesNotMatch(ui.runSheet(s(),now),/completion changes requested/);assert.match(ui.runSheet(s(),now),/Awaiting verification/);
  store.verifyTask(item.id);assert.equal(changed(s()).length,0);assert(!rank(s().tasks).includes(item.id));
  assert.equal(current().scope,'Named greeter and accessible entrance.');assert.equal(current().completionEvidenceHistory.length,1);
});
test('pre-event review scopes changes to your tasks and projects only safe labels, not review text or reports',()=>{
  const s=state([task('mine'),task('other',{owner:'jack'}),task('unassigned',{owner:''}),task('ordinary',{completionReview:null})]),before=structuredClone(s);
  assert.deepEqual(changed(s).map(t=>t.id),['mine','other','unassigned']);assert.deepEqual(changed(s,{mine:true,actor:'maya'}).map(t=>t.id),['mine']);assert.equal(changed(s,{mine:true}).length,0);
  const html=ui.preparationReview(s,now,{mine:true,actor:'maya'});assert.match(html,/Completion changes requested · 1/);assert.match(html,/data-id="mine"/);assert.doesNotMatch(html,/data-id="other"|PRIVATE_REVIEW_REASON|PRIVATE_REPORTER/);assert.deepEqual(s,before);
});
test('run-sheet counts only scheduled scoped active requests and preserves status without exporting reasons or history',()=>{
  const s=state([task('mine',{schedule:slot,note:'PRIVATE_NOTE',comments:[{text:'PRIVATE_COMMENT'}]}),task('other',{owner:'jack',schedule:slot}),task('prep'),task('normal',{schedule:slot,completionReview:null})]),before=structuredClone(s);
  const html=ui.runSheet(s,now,{mine:true,actor:'maya'});
  assert.match(html,/1 activity has completion changes requested/);assert.equal((html.match(/<span>Changes requested<\/span>/g)||[]).length,1);assert.match(html,/>In progress<span>Changes requested/);
  assert.match(html,/Review notes are not included/);assert.doesNotMatch(html,/PRIVATE_|>other<|>prep<|<form|data-action/);assert.deepEqual(s,before);
  assert.match(ui.runSheet(s,now),/2 activities have completion changes requested/);assert.doesNotMatch(ui.runSheet(s,now,{mine:true,actor:'unknown'}),/completion changes requested/);
});
test('live current, next and elapsed activities keep the request visible without replacing clock or status facts',()=>{
  for(const start of ['08:00','09:00','11:00']){
    const s=state([task('check',{schedule:{...slot,start:'2026-10-03T'+start,end:'2026-10-03T'+(start==='08:00'?'08:30':start==='09:00'?'10:00':'12:00')}})]),before=structuredClone(s);
    const html=ui.view(s,true,Date.parse(now));assert.match(html,/Changes requested/);assert.match(html,/progress/);assert.deepEqual(s,before);
    assert.match(ui.clock(s,Date.parse(now)).markup,/Changes requested/);
  }
});
test('real task-list responsibility labels distinguish active requests from acceptance and resubmitted verification',()=>{
  const source=readFileSync('legacy/app.js','utf8'),context=vm.createContext({GatherPriorities,member:()=>({name:'Maya Fictional'})});
  vm.runInContext(source.slice(source.indexOf('  const commitment ='),source.indexOf('  const latestUpdate ='))+'globalThis.label=commitment;',context);
  assert.equal(context.label(task('returned')),'Changes requested · review and resubmit');
  assert.equal(context.label(task('reported',{reportedAt:now,reportedBy:'Maya',requiresVerification:true})),'Reported complete by Maya · needs verification');
  assert.equal(context.label(task('accepted',{completionReview:null,acceptedBy:'maya'})),'Accepted by Maya');
  assert.equal(context.label(task('verified',{status:'done',verifiedAt:now,verifiedBy:'jack'})),'Verified by Maya Fictional');
});
