import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/completion-ui.js';
const create=()=>GatherStore.createStore({storage:null});
const current=(store,id)=>store.getState().tasks.find(task=>task.id===id);
const pending=()=>{
  const store=create(),task=store.addTask({title:'Fictional school welcome review',scope:'An approved route and named greeter.',owner:'maya',requiresVerification:true,dueDate:'2027-02-01'});
  store.acceptTask(task.id,'maya');store.reportCompletion(task.id,{note:'Route checked; greeter not yet named.',links:['https://www.nasa.gov/'],fileIds:['shared_checklist']},'maya');
  return {store,task:current(store,task.id)};
};
test('organizer returns a pending completion with a reason, retaining original evidence and owner progress attribution',()=>{
  const {store,task}=pending();let saves=0;store.subscribe(()=>saves++);
  const returned=store.returnCompletion(task.id,'Name the greeter and confirm the accessible entrance.');assert.equal(saves,1);
  assert.equal(returned.status,'progress');assert.equal(returned.reportedAt,'');assert.equal(returned.reportedBy,'');assert.equal(returned.verifiedAt,'');assert.equal(returned.completionEvidence,null);assert.equal(returned.completionResult,null);
  for(const key of ['owner','scope','title','note','dueDate','schedule','dependencies','acceptedAt','acceptedBy','updatedAt','updatedBy','ownerRespondedAt'])assert.deepEqual(returned[key],task[key],key);
  assert.deepEqual(returned.completionEvidenceHistory.at(0),task.completionEvidence);assert.equal(returned.completionReview.actor,'jack');assert.equal(returned.completionReview.reportedAt,task.reportedAt);assert.equal(returned.completionReview.reportedBy,task.reportedBy);assert.match(returned.comments.at(-1).text,/Earlier report by Maya Singh/);assert.ok(returned.comments.at(-1).text.includes(task.note));
  const raw=store.exportState(),loaded=GatherStore.createStore({storage:{getItem:()=>raw,setItem(){}}});assert.deepEqual(current(loaded,task.id).completionReview,returned.completionReview);
  const html=GatherCompletionUI.section(returned,true);assert.match(html,/Changes requested/);assert.match(html,/Name the greeter/);assert.match(html,/No current completion report/);assert.doesNotMatch(html,/id="completionEvidenceForm"/);
});
test('owner progress preserves the changes request; a fresh report supersedes it and only explicit verification completes the task',()=>{
  const {store,task}=pending();store.returnCompletion(task.id,'Record the missing greeter.');
  store.updateTask(task.id,{status:'progress',note:'Confirming the greeter now.'},'maya');assert.ok(current(store,task.id).completionReview);assert.equal(current(store,task.id).scope,task.scope);
  store.reportCompletion(task.id,'Greeter named and accessible route confirmed.','maya');const resubmitted=current(store,task.id);assert.equal(resubmitted.completionReview,null);assert.ok(resubmitted.reportedAt);assert.equal(resubmitted.status,'progress');assert.equal(resubmitted.completionEvidenceHistory.length,1);assert.ok(resubmitted.comments.some(comment=>comment.kind==='completion-returned'));
  store.verifyTask(task.id);const verified=current(store,task.id);assert.equal(verified.status,'done');assert.equal(verified.reportedBy,'Maya Singh');assert.equal(verified.verifiedBy,'jack');assert.equal(verified.completionReview,null);assert.equal(verified.scope,task.scope);
  const before=store.exportState();assert.throws(()=>store.returnCompletion(task.id,'Too late'),/pending/);assert.equal(store.exportState(),before);
});
test('returning completion rejects unauthorized, invalid, repeated and nonpending decisions without changes',()=>{
  const {store,task}=pending(),before=store.exportState();
  for(const actor of ['maya','dev']){assert.throws(()=>store.returnCompletion(task.id,'Change this.',actor),/organizer/);assert.equal(store.exportState(),before);}
  for(const reason of ['', ' ',null,{},'x'.repeat(3001),'bad\u0000reason']){assert.throws(()=>store.returnCompletion(task.id,reason));assert.equal(store.exportState(),before);}
  store.returnCompletion(task.id,'Record the agreed result.');const stable=store.exportState();assert.throws(()=>store.returnCompletion(task.id,'Repeated'),/pending/);assert.equal(store.exportState(),stable);
  assert.throws(()=>store.returnCompletion('dietary','No pending report.'),/pending/);assert.equal(store.exportState(),stable);
  const ordinary=store.addTask({title:'No verification required',owner:'maya'});store.reportCompletion(ordinary.id,'Done.','maya');const completed=store.exportState();assert.throws(()=>store.returnCompletion(ordinary.id,'Reopen separately.'),/pending/);assert.equal(store.exportState(),completed);
});
test('legacy reports without evidence retain a bounded excerpt plus full report text, and changing outcome supersedes the active request',()=>{
  const {store,task}=pending(),raw=JSON.parse(store.exportState()),legacy=raw.tasks.find(t=>t.id===task.id);delete legacy.completionEvidence;legacy.note='x'.repeat(4000);
  let saved=JSON.stringify(raw);const loaded=GatherStore.createStore({storage:{getItem:()=>saved,setItem:(_key,value)=>saved=value}});
  const returned=loaded.returnCompletion(task.id,'Check the missing details.');assert.equal(returned.completionEvidenceHistory.length,1);assert.ok(returned.completionEvidenceHistory[0].note.length<=3000);assert.match(returned.completionEvidenceHistory[0].note,/Earlier report excerpt/);assert.ok(returned.comments.at(-1).text.includes('x'.repeat(4000)));
  assert.equal(GatherStore.createStore({storage:{getItem:()=>saved,setItem(){}}}).getState().persistence,'saved');
  loaded.setTaskOutcome(task.id,'A new agreed result.');assert.equal(current(loaded,task.id).completionReview,null);assert.ok(current(loaded,task.id).comments.some(comment=>comment.kind==='completion-returned'));
});
test('changes-request UI is escaped and source exposes one explicit reasoned organizer action',()=>{
  const html=GatherCompletionUI.section({status:'progress',completionReview:{note:'<script>untrusted</script>',at:new Date().toISOString()},completionEvidenceHistory:[]},false);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/Nothing was verified/);
  const source=readFileSync('legacy/app.js','utf8');assert.match(source,/What needs changing\?/);assert.match(source,/Return completion for changes/);assert.match(source,/store\.returnCompletion\(form.dataset.id,data.note,ui.actor\)/);assert.match(source,/No email is sent/);
  for(const path of ['legacy/hosted-store.js','scripts/prepare.mjs'])assert.match(readFileSync(path,'utf8'),/'returnCompletion'/);
});
test('malformed persisted review decisions fail closed without replacing saved workspace bytes',()=>{
  const {store,task}=pending();store.returnCompletion(task.id,'Check the missing result.');const original=JSON.parse(store.exportState()),review=current(store,task.id).completionReview;
  for(const value of [{},[],{...review,note:''},{...review,note:'x'.repeat(3001)},{...review,actor:'not-a-member'},{...review,at:'not a date'},{...review,reportedAt:'invalid'},{...review,execute:true}]){
    const raw=structuredClone(original);raw.tasks.find(t=>t.id===task.id).completionReview=value;const saved=JSON.stringify(raw);let writes=0;
    const loaded=GatherStore.createStore({storage:{getItem:()=>saved,setItem(){writes++;}}});assert.equal(loaded.getState().persistence,'unavailable');assert.equal(writes,0);
  }
});
test('a new owner-email completion report supersedes the active request and later progress cannot revive it',()=>{
  const {store,task}=pending();store.returnCompletion(task.id,'Name the greeter.');
  const email=store.addMessage({taskId:task.id,sender:'Maya Singh',subject:'Welcome route complete',body:'The welcome route and named greeter are complete.'});
  store.applyMessage(email.id);const resubmitted=current(store,task.id);assert.ok(resubmitted.reportedAt);assert.equal(resubmitted.status,'progress');assert.equal(resubmitted.completionReview,null);assert.ok(resubmitted.comments.some(comment=>comment.kind==='completion-returned'));
  store.updateTask(task.id,{status:'progress',note:'Checking one further detail.'},'maya');assert.equal(current(store,task.id).reportedAt,'');assert.equal(current(store,task.id).completionReview,null);assert.doesNotMatch(GatherCompletionUI.section(current(store,task.id),true),/Changes requested/);
});
test('manually completing after an explicit verification-policy change supersedes the request, including after reopening',()=>{
  const {store,task}=pending();store.returnCompletion(task.id,'Review the remaining work.');store.updateTask(task.id,{requiresVerification:false});store.updateTask(task.id,{status:'done'});assert.equal(current(store,task.id).completionReview,null);store.updateTask(task.id,{status:'progress'});assert.equal(current(store,task.id).completionReview,null);
});
test('historical control characters do not prevent return; only the synthetic evidence excerpt is cleaned',()=>{
  const {store,task}=pending(),raw=JSON.parse(store.exportState()),legacy=raw.tasks.find(t=>t.id===task.id);delete legacy.completionEvidence;legacy.note='Earlier\u0001report\u007ftext';
  let saved=JSON.stringify(raw);const loaded=GatherStore.createStore({storage:{getItem:()=>saved,setItem:(_key,value)=>saved=value}});assert.equal(loaded.getState().persistence,'saved');
  const returned=loaded.returnCompletion(task.id,'Record the missing details.');assert.equal(returned.note,legacy.note);assert.ok(returned.comments.at(-1).text.includes(legacy.note));assert.doesNotMatch(returned.completionEvidenceHistory[0].note,/[\u0001\u007f]/);assert.equal(GatherStore.createStore({storage:{getItem:()=>saved,setItem(){}}}).getState().persistence,'saved');
});
