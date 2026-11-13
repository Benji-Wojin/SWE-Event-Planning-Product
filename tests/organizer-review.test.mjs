import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/priorities.js';
import '../legacy/recovery-ui.js';

const reviews=state=>GatherRecoveryUI.organizerReviews(state.tasks).map(({task,kind})=>[task.id,kind]);
const panel=(state,opts)=>GatherRecoveryUI.create({h:value=>String(value).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c])}).organizerReviewPanel(state,opts);
const pending=(kind,createdAt)=>({kind,createdAt,status:'pending',note:'PRIVATE_REQUEST'});
const row=(id,extra)=>({id,title:id,owner:'maya',status:'todo',...extra});

test('organizer review projects actionable facts, oldest first, regardless of due date',()=>{
  const tasks=[
    row('return',{completionReview:{note:'PRIVATE_RETURN'}}),
    row('legacy',{status:'done',requiresVerification:true}),
    row('accepted',{acceptedAt:'2026-11-01'}),
    row('date',{recoveryRequests:[pending('date','2026-11-05')]}),
    row('help',{dueDate:'2040-01-01',recoveryRequests:[pending('help','2026-11-02')]}),
    row('verified',{status:'done',requiresVerification:true,verifiedAt:'2026-11-03',completionEvidence:{at:'2026-11-04'},completionEvidenceReviewAt:'2026-11-03'}),
    row('amend',{status:'done',requiresVerification:true,verifiedAt:'2026-11-01',completionEvidence:{at:'2026-11-03'}}),
    row('reported',{requiresVerification:true,reportedAt:'2026-11-04',recoveryRequests:[pending('help','2026-11-01')]}),
    row('resolved',{recoveryRequests:[{...pending('help','2026-11-01'),status:'resolved'}]}),
  ];
  const before=structuredClone(tasks);
  assert.deepEqual(reviews({tasks}),[['help','help'],['amend','amendment'],['reported','completion'],['date','date']]);
  assert.deepEqual(tasks,before);
});

test('review moves through actual request, verification, and amendment transitions without writes on open',()=>{
  const store=GatherStore.createStore({storage:null});
  const a=store.addTask({title:'Confirm handover',owner:'maya',requiresVerification:true});
  const state=()=>({...store.getState(),tasks:store.getState().tasks.filter(t=>t.id===a.id)});
  store.requestRecovery(a.id,{kind:'help',note:'PRIVATE_NEED'},'maya');
  assert.deepEqual(reviews(state()),[[a.id,'help']]);
  const requestId=state().tasks[0].recoveryRequests[0].id,before=store.exportState();
  assert.match(panel(state()),/Respond to help request/);
  assert.doesNotMatch(panel(state()),/PRIVATE_NEED/);
  assert.equal(store.exportState(),before);
  store.resolveRecovery(a.id,{action:'checkin',requestId,note:'Agreed to check again',reviewAfter:'2040-01-02'},'jack');
  assert.equal(panel(state()),'');
  store.reportCompletion(a.id,'Reviewed with team.','maya');
  assert.deepEqual(reviews(state()),[[a.id,'completion']]);
  store.returnCompletion(a.id,'Please confirm the handover.','jack');
  assert.deepEqual(reviews(state()),[]);
  store.reportCompletion(a.id,'Handover confirmed.','maya');
  store.verifyTask(a.id,'jack');
  assert.equal(panel(state()),'');
  const verifiedAt=state().tasks[0].verifiedAt;
  store.setCompletionEvidence(a.id,{note:'PRIVATE_ATTACHMENT_NOTE'},'maya');
  assert.deepEqual(reviews(state()),[[a.id,'amendment']]);
  assert.doesNotMatch(panel(state()),/PRIVATE_ATTACHMENT_NOTE/);
  store.reviewCompletionEvidence(a.id,state().tasks[0].revision,'jack');
  assert.equal(panel(state()),'');
  assert.equal(state().tasks[0].status,'done');
  assert.equal(state().tasks[0].verifiedAt,verifiedAt);
});

test('a pending verification keeps its review route when required work reopens, and becomes verifiable again',()=>{
  const store=GatherStore.createStore({storage:null});
  const required=store.addTask({title:'Fictional required route check',owner:'maya',requiresVerification:true});
  const related=store.addTask({title:'Fictional parallel setup',owner:'maya'});
  const task=store.addTask({title:'Confirm fictional handover',owner:'maya',requiresVerification:true,dependencies:[
    {taskId:required.id,kind:'dependency',reason:'Needs the checked route.'},
    {taskId:related.id,kind:'related',reason:'Shares the same handover.'},
  ]});
  const state=()=>store.getState();
  const review=()=>GatherRecoveryUI.organizerReviews(state().tasks).find(row=>row.task.id===task.id);
  const route=new RegExp(`data-action="review-organizer-item"[^>]*data-id="${task.id}"[^>]*data-review-kind="completion"`);
  const verify=/aria-label="Verify completion: Confirm fictional handover"/;
  const waiting=/aria-label="Review required work: Confirm fictional handover"/;
  store.reportCompletion(required.id,'Route checked.','maya');
  store.verifyTask(required.id,'jack');
  store.reportCompletion(task.id,'FICTIONAL_PRIVATE_PARENT_REPORT','maya');
  const reportedAt=review().at;
  assert.match(panel(state()),route);
  assert.match(panel(state()),verify,'open related work does not block verification');

  store.updateTask(required.id,{status:'todo'},'jack');
  const snapshot=store.exportState(),blocked=panel(state());
  assert.match(blocked,route);
  assert.match(blocked,waiting);
  assert.match(blocked,/Verification waiting on required work/);
  assert.doesNotMatch(blocked,/FICTIONAL_PRIVATE_PARENT_REPORT/);
  assert.doesNotMatch(blocked,verify);
  assert.equal(review().kind,'completion');
  assert.equal(review().at,reportedAt);
  assert.equal(review().task.reportedAt,reportedAt);
  assert.throws(()=>store.verifyTask(task.id,'jack'),/Finish or verify required work/);
  assert.equal(store.exportState(),snapshot);

  store.reportCompletion(required.id,'Route rechecked.','maya');
  assert.match(panel(state()),waiting,'a prerequisite report is not organizer verification');
  store.verifyTask(required.id,'jack');
  assert.match(panel(state()),route);
  assert.match(panel(state()),verify);
  assert.doesNotMatch(panel(state()),waiting);
  assert.equal(review().at,reportedAt);
  assert.equal(store.verifyTask(task.id,'jack').status,'done');
  assert.equal(review(),undefined);
});

test('a reopened prerequisite does not change an already verified task’s evidence amendment review',()=>{
  const store=GatherStore.createStore({storage:null});
  const required=store.addTask({title:'Fictional required access check',owner:'maya'});
  const task=store.addTask({title:'Fictional confirmed handover',owner:'maya',requiresVerification:true,dependencies:[
    {taskId:required.id,kind:'dependency',reason:'Confirm access before the handover.'},
  ]});
  store.reportCompletion(required.id,'Access checked.','maya');
  store.reportCompletion(task.id,'Original handover report.','maya');
  const verified=store.verifyTask(task.id,'jack');
  store.updateTask(required.id,{status:'todo'},'jack');
  const amended=store.setCompletionEvidence(task.id,{note:'FICTIONAL_PRIVATE_AMENDMENT'},'maya');
  const state=()=>store.getState();
  assert.deepEqual(reviews(state()),[[task.id,'amendment']]);
  assert.match(panel(state()),/data-review-kind="amendment" aria-label="Review amended evidence: Fictional confirmed handover"/);
  assert.doesNotMatch(panel(state()),/Review required work|Verification waiting on required work|FICTIONAL_PRIVATE_AMENDMENT/);
  const acknowledged=store.reviewCompletionEvidence(task.id,amended.revision,'jack');
  assert.equal(acknowledged.status,'done');
  assert.equal(acknowledged.verifiedAt,verified.verifiedAt);
  assert.equal(acknowledged.verifiedBy,verified.verifiedBy);
  assert.equal(acknowledged.completionEvidenceReviewAt,verified.verifiedAt);
  assert.equal(state().tasks.find(item=>item.id===required.id).status,'todo');
  assert.equal(panel(state()),'');
});

test('overview lists five reviews by default with access to all, escapes titles, and has no write controls',()=>{
  const tasks=Array.from({length:7},(_,i)=>row('t'+i,{title:i===0?'<img "test">':'Task '+i,recoveryRequests:[pending('help','2026-11-01')]}));
  const state={tasks,members:[{id:'maya',name:'Former <owner>',active:false}]};
  const compact=panel(state),full=panel(state,{expanded:true});
  assert.match(compact,/aria-expanded="false"[^>]+>Show all 7 reviews/);
  assert.match(full,/aria-expanded="true"[^>]+>Show fewer reviews/);
  assert.equal((compact.match(/data-action="review-organizer-item"/g)||[]).length,5);
  assert.equal((full.match(/data-action="review-organizer-item"/g)||[]).length,7);
  assert.match(full,/Respond to help request: &lt;img &quot;test&quot;&gt;/);
  assert.match(full,/Former &lt;owner&gt; · inactive/);
  assert.doesNotMatch(full,/<img|PRIVATE_REQUEST|<form|data-action="verify-task"/);
  const app=readFileSync('legacy/app.js','utf8');
  assert.match(app,/isOrganizer\(\)\?recovery\.organizerReviewPanel/);
  assert.match(app,/function openOrganizerReview[\s\S]+if\(!isOrganizer\(\)\|\|window\.GatherAccessLost\)return/);
});
