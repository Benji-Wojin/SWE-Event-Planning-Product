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
